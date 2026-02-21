# src/llm.py
from __future__ import annotations

import os
import json
import requests
from dataclasses import dataclass
from typing import Optional


class LLMError(Exception):
    pass


def _base_url() -> str:
    # You can override with: export OLLAMA_BASE_URL="http://localhost:11434"
    return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")


def _preferred_model() -> str:
    # You can override with: export OLLAMA_MODEL="llama3.1"
    return os.getenv("OLLAMA_MODEL", "llama3.1")


def _timeout_s() -> float:
    try:
        return float(os.getenv("OLLAMA_TIMEOUT", "30"))
    except Exception:
        return 30.0


def _get_installed_models() -> list[str]:
    """
    Returns list like ["llama3.1:latest", "mistral:latest", ...]
    """
    try:
        r = requests.get(f"{_base_url()}/api/tags", timeout=_timeout_s())
        if r.status_code != 200:
            return []
        data = r.json() or {}
        models = data.get("models") or []
        out = []
        for m in models:
            name = (m or {}).get("name")
            if name:
                out.append(str(name))
        return out
    except Exception:
        return []


def _choose_model() -> str:
    preferred = _preferred_model()
    installed = _get_installed_models()

    # exact match
    if preferred in installed:
        return preferred

    # match without ":latest"
    if ":" not in preferred:
        alt = f"{preferred}:latest"
        if alt in installed:
            return alt

    # fall back to first installed model if any
    if installed:
        return installed[0]

    # no models found (or ollama down)
    return preferred  # still return preferred; error message will guide


def _extract_text_from_ollama_generate(resp_json: dict) -> str:
    return str(resp_json.get("response") or "").strip()


def _extract_text_from_ollama_chat(resp_json: dict) -> str:
    msg = (resp_json.get("message") or {})
    return str(msg.get("content") or "").strip()


def _extract_text_from_openai_compat(resp_json: dict) -> str:
    # /v1/chat/completions shape
    choices = resp_json.get("choices") or []
    if not choices:
        return ""
    msg = (choices[0].get("message") or {})
    return str(msg.get("content") or "").strip()


def llm_summarize(prompt: str, system: str | None = None) -> str:
    """
    Best-effort local LLM call (Ollama). Tries:
      1) /api/generate
      2) /api/chat
      3) /v1/chat/completions (OpenAI-compatible)
    """
    base = _base_url()
    model = _choose_model()
    timeout = _timeout_s()

    # Helpful pre-check for "model not found"
    installed = _get_installed_models()
    if installed and model not in installed:
        # Try to recover: if user asked for llama3.1 but only llama3 exists, pick first installed
        model = installed[0]

    # 1) /api/generate
    try:
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system

        r = requests.post(f"{base}/api/generate", json=payload, timeout=timeout)
        if r.status_code == 200:
            txt = _extract_text_from_ollama_generate(r.json() or {})
            if txt:
                return txt
            raise LLMError("LLM returned empty response.")
        if r.status_code != 404:
            # non-404 means endpoint exists; surface model errors nicely
            try:
                j = r.json()
                err = j.get("error") if isinstance(j, dict) else None
            except Exception:
                err = None
            if err and "not found" in str(err).lower() and "model" in str(err).lower():
                raise LLMError(
                    f"Ollama model not found: {model}. Install one: `ollama pull llama3.1` "
                    f"or set OLLAMA_MODEL to an installed model."
                )
            raise LLMError(f"Ollama HTTP {r.status_code}: {r.text[:300]}")
    except requests.exceptions.ConnectionError:
        raise LLMError(
            f"Cannot reach Ollama at {base}. Start it with `ollama serve` and confirm with: "
            f"`curl {base}/api/tags`"
        )
    except requests.exceptions.Timeout:
        raise LLMError("Ollama request timed out.")
    except LLMError:
        raise
    except Exception as e:
        # if this fails for non-404 reasons, continue to fallbacks
        pass

    # 2) /api/chat
    try:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
        }

        r = requests.post(f"{base}/api/chat", json=payload, timeout=timeout)
        if r.status_code == 200:
            txt = _extract_text_from_ollama_chat(r.json() or {})
            if txt:
                return txt
            raise LLMError("LLM returned empty response.")
        if r.status_code != 404:
            try:
                j = r.json()
                err = j.get("error") if isinstance(j, dict) else None
            except Exception:
                err = None
            if err and "not found" in str(err).lower() and "model" in str(err).lower():
                raise LLMError(
                    f"Ollama model not found: {model}. Install one: `ollama pull llama3.1` "
                    f"or set OLLAMA_MODEL to an installed model."
                )
            raise LLMError(f"Ollama HTTP {r.status_code}: {r.text[:300]}")
    except LLMError:
        raise
    except Exception:
        pass

    # 3) OpenAI-compatible fallback: /v1/chat/completions
    try:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {"model": model, "messages": messages}

        r = requests.post(f"{base}/v1/chat/completions", json=payload, timeout=timeout)
        if r.status_code == 200:
            txt = _extract_text_from_openai_compat(r.json() or {})
            if txt:
                return txt
            raise LLMError("LLM returned empty response.")
        raise LLMError(
            f"Ollama endpoints not found at {base}. "
            f"Tried /api/generate, /api/chat, /v1/chat/completions. "
            f"Make sure Ollama is running and base URL is correct."
        )
    except requests.exceptions.ConnectionError:
        raise LLMError(
            f"Cannot reach Ollama at {base}. Start it with `ollama serve` and confirm with: "
            f"`curl {base}/api/tags`"
        )
    except requests.exceptions.Timeout:
        raise LLMError("Ollama request timed out.")
# src/llm_local.py
from __future__ import annotations

import requests

OLLAMA_URL = "http://localhost:11434/api/generate"
DEFAULT_MODEL = "llama3.1:8b"  # change if you pulled a different model


def llm_generate(prompt: str, system: str = "", model: str = DEFAULT_MODEL, temperature: float = 0.2) -> str:
    """
    Simple local Ollama wrapper.
    Requires: Ollama running locally (ollama serve) and model pulled.
    """
    payload = {
        "model": model,
        "prompt": prompt if not system else f"SYSTEM:\n{system}\n\nUSER:\n{prompt}",
        "stream": False,
        "options": {"temperature": float(temperature)},
    }

    r = requests.post(OLLAMA_URL, json=payload, timeout=120)
    r.raise_for_status()
    return (r.json().get("response") or "").strip()

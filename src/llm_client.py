"""
文心一言 / 千帆大模型客户端
==========================
仅做接口封装；没有 API Key 时不影响整个规则引擎运行。
密钥从环境变量读取：WENXIN_API_KEY / WENXIN_SECRET_KEY。
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import requests

from config import (
    LLM_API_KEY,
    LLM_ENDPOINT,
    LLM_MODEL,
    LLM_SECRET_KEY,
    LLM_TIMEOUT,
    LLM_TOKEN_URL,
    OUTPUT_DIR,
)


class WenxinClient:
    """文心一言 v2 API 封装，token 缓存到 output/.wenxin_token.json。"""

    def __init__(
        self,
        api_key: str | None = None,
        secret_key: str | None = None,
        model: str = LLM_MODEL,
        token_cache: Path | None = None,
    ) -> None:
        self.api_key = api_key or LLM_API_KEY
        self.secret_key = secret_key or LLM_SECRET_KEY
        self.model = model
        self.token_cache = token_cache or (OUTPUT_DIR / ".wenxin_token.json")
        self.token = ""
        self._load_or_fetch_token()

    @property
    def available(self) -> bool:
        return bool(self.api_key and self.secret_key and self.token)

    def _load_or_fetch_token(self) -> None:
        if not (self.api_key and self.secret_key):
            return
        try:
            if self.token_cache.exists():
                data = json.loads(self.token_cache.read_text(encoding="utf-8"))
                if data.get("access_token") and data.get("expires_at", 0) > time.time() + 3600:
                    self.token = data["access_token"]
                    return
        except Exception:
            pass
        self.token = self._fetch_token()

    def _fetch_token(self) -> str:
        resp = requests.post(
            LLM_TOKEN_URL,
            params={
                "grant_type": "client_credentials",
                "client_id": self.api_key,
                "client_secret": self.secret_key,
            },
            timeout=LLM_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token", "")
        if token:
            try:
                self.token_cache.parent.mkdir(parents=True, exist_ok=True)
                self.token_cache.write_text(
                    json.dumps(
                        {
                            "access_token": token,
                            "expires_in": data.get("expires_in", 2592000),
                            "expires_at": time.time() + int(data.get("expires_in", 2592000)),
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
            except Exception:
                pass
        return token

    def _url(self) -> str:
        return f"{LLM_ENDPOINT}?access_token={self.token}"

    def chat(self, system_prompt: str, user_content: str, temperature: float = 0.3) -> str:
        if not self.available:
            raise RuntimeError("文心一言 API Key 未配置，无法调用 LLM。")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "user", "content": user_content},
            ],
            "system": system_prompt,
            "temperature": temperature,
            "stream": False,
        }
        resp = requests.post(self._url(), json=payload, timeout=LLM_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if "error_code" in data:
            raise RuntimeError(f"文心一言返回错误：{data.get('error_code')} {data.get('error_msg')}")
        return data.get("result", "")

    def chat_with_history(self, messages: list[dict[str, str]], system_prompt: str = "", temperature: float = 0.3) -> str:
        if not self.available:
            raise RuntimeError("文心一言 API Key 未配置，无法调用 LLM。")
        payload = {
            "model": self.model,
            "messages": messages,
            "system": system_prompt,
            "temperature": temperature,
            "stream": False,
        }
        resp = requests.post(self._url(), json=payload, timeout=LLM_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if "error_code" in data:
            raise RuntimeError(f"文心一言返回错误：{data.get('error_code')} {data.get('error_msg')}")
        return data.get("result", "")

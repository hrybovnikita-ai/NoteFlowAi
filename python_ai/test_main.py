import json
import os
import unittest
from unittest.mock import patch

import httpx

import main

TEST_TOKEN = "local-test-token-with-at-least-32-characters"


class ChatServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.environment = patch.dict(
            "os.environ",
            {
                "CHAT_SERVICE_TOKEN": TEST_TOKEN,
                "GEMINI_API_KEY": "test-key",
                "GEMINI_MODEL": "gemini-2.5-flash",
            },
            clear=False,
        )
        self.environment.start()
        self.responses = [
            {
                "candidates": [
                    {"content": {"parts": [{"text": "A useful "}, {"text": "answer."}]}}
                ]
            }
        ]
        self.generation_config = None

        def gemini_handler(request):
            self.assertEqual(request.headers["x-goog-api-key"], "test-key")
            self.generation_config = json.loads(request.content)["generationConfig"]
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content="".join(f"data: {json.dumps(item)}\n\n" for item in self.responses),
            )

        self.gemini_client = httpx.AsyncClient(
            transport=httpx.MockTransport(gemini_handler)
        )
        main.app.state.gemini_client = self.gemini_client
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.gemini_client.aclose()
        self.environment.stop()

    async def test_internal_token_is_required(self):
        response = await self.client.post(
            "/v1/chat/stream",
            json={"messages": [{"role": "user", "text": "hello"}]},
        )
        self.assertEqual(response.status_code, 401)

    async def test_weak_internal_token_is_a_configuration_error(self):
        with patch.dict(os.environ, {"CHAT_SERVICE_TOKEN": "too-short"}):
            response = await self.client.post(
                "/v1/chat/stream",
                headers={"Authorization": f"Bearer {TEST_TOKEN}"},
                json={"messages": [{"role": "user", "text": "hello"}]},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "CHAT_SERVICE_NOT_CONFIGURED")

    async def test_message_roles_must_alternate_and_end_with_a_user(self):
        response = await self.client.post(
            "/v1/chat/stream",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
            json={
                "messages": [
                    {"role": "user", "text": "hello"},
                    {"role": "user", "text": "again"},
                ]
            },
        )
        self.assertEqual(response.status_code, 422)

    async def test_stream_returns_gemini_deltas_and_completion(self):
        response = await self.client.post(
            "/v1/chat/stream",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
            json={
                "messages": [
                    {"role": "user", "text": "hello"},
                    {"role": "model", "text": "Hi there."},
                    {"role": "user", "text": "What next?"},
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('event: delta\ndata: {"text": "A useful answer."}', response.text)
        self.assertIn("event: complete", response.text)
        self.assertIn("maxOutputTokens", self.generation_config)
        self.assertGreaterEqual(self.generation_config["maxOutputTokens"], 1)
        self.assertLessEqual(self.generation_config["maxOutputTokens"], 8192)

    async def test_gemini_rate_limit_is_mapped_before_streaming(self):
        await self.gemini_client.aclose()
        self.gemini_client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(429, json={"error": "quota"})
            )
        )
        main.app.state.gemini_client = self.gemini_client
        response = await self.client.post(
            "/v1/chat/stream",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
            json={"messages": [{"role": "user", "text": "hello"}]},
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["detail"]["code"], "GEMINI_QUOTA_EXCEEDED")

    async def test_context_limit_is_enforced(self):
        response = await self.client.post(
            "/v1/chat/stream",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
            json={
                "messages": [
                    {"role": "user" if index % 2 == 0 else "model", "text": "x" * 12000}
                    for index in range(7)
                ]
            },
        )
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()

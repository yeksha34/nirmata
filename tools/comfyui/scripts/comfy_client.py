#!/usr/bin/env python3
"""
ComfyUI API Client
Lightweight bridge for submitting prompt workflows via HTTP POST /prompt
and monitoring execution progress via WebSocket.
"""

import os
import sys
import json
import uuid
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from typing import Dict, Any, List, Optional

try:
    import websocket
except ImportError:
    websocket = None


class ComfyClient:
    def __init__(self, host: Optional[str] = None, port: Optional[int] = None):
        env_host = os.environ.get("COMFYUI_HOST", "127.0.0.1:8188")
        if host is None:
            if ":" in env_host:
                self.host, port_str = env_host.split(":", 1)
                self.port = int(port_str)
            else:
                self.host = env_host
                self.port = 8188
        else:
            self.host = host
            self.port = port if port is not None else 8188

        self.server_address = f"{self.host}:{self.port}"
        self.client_id = str(uuid.uuid4())

    def is_online(self) -> bool:
        """Check if ComfyUI server is reachable."""
        try:
            req = urllib.request.Request(f"http://{self.server_address}/system_stats")
            with urllib.request.urlopen(req, timeout=3) as res:
                return res.status == 200
        except Exception:
            return False

    def queue_prompt(self, workflow_prompt: Dict[str, Any]) -> str:
        """Submit a prompt graph to the ComfyUI queue."""
        payload = {
            "prompt": workflow_prompt,
            "client_id": self.client_id
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(f"http://{self.server_address}/prompt", data=data)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result.get("prompt_id")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"ComfyUI rejected prompt (HTTP {e.code}): {err_body}")
        except urllib.error.URLError as e:
            raise ConnectionError(f"Could not connect to ComfyUI at {self.server_address}: {e}")

    def wait_for_completion(self, prompt_id: str, timeout: int = 1800) -> Dict[str, Any]:
        """Listen to WebSocket events until prompt execution completes or times out."""
        if websocket is None:
            # Fallback to HTTP polling if websocket module is not installed
            return self._poll_history(prompt_id, timeout)

        ws_url = f"ws://{self.server_address}/ws?clientId={self.client_id}"
        ws = websocket.WebSocket()
        try:
            ws.connect(ws_url)
        except Exception as e:
            # Fallback to HTTP polling on connection error
            return self._poll_history(prompt_id, timeout)

        start_time = time.time()
        try:
            while True:
                if time.time() - start_time > timeout:
                    raise TimeoutError(f"Prompt {prompt_id} timed out after {timeout} seconds.")
                msg_raw = ws.recv()
                if not msg_raw or not isinstance(msg_raw, str):
                    continue
                msg = json.loads(msg_raw)
                msg_type = msg.get("type")
                data = msg.get("data", {})

                if msg_type == "executing":
                    if data.get("node") is None and data.get("prompt_id") == prompt_id:
                        break  # Execution finished
                elif msg_type == "execution_error":
                    if data.get("prompt_id") == prompt_id:
                        raise RuntimeError(f"ComfyUI execution error: {data.get('exception_message')}")
        finally:
            ws.close()

        return self.get_history(prompt_id)

    def _poll_history(self, prompt_id: str, timeout: int = 1800) -> Dict[str, Any]:
        """Fallback polling mechanism when WebSocket is unavailable."""
        start_time = time.time()
        last_log = 0.0
        while time.time() - start_time < timeout:
            history = self.get_history(prompt_id)
            if prompt_id in history:
                return history
            elapsed = time.time() - start_time
            if elapsed - last_log >= 15.0:
                print(f"      [Progress] Waiting for generation... elapsed: {int(elapsed)}s (timeout: {timeout}s)")
                last_log = elapsed
            time.sleep(2.0)
        raise TimeoutError(f"Prompt {prompt_id} timed out during history polling after {timeout} seconds.")

    def get_history(self, prompt_id: str) -> Dict[str, Any]:
        """Fetch execution outputs from /history/<prompt_id>."""
        url = f"http://{self.server_address}/history/{prompt_id}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode("utf-8"))

    def get_image(self, filename: str, subfolder: str = "", folder_type: str = "output") -> bytes:
        """Download raw image binary from ComfyUI /view."""
        params = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": folder_type})
        url = f"http://{self.server_address}/view?{params}"
        with urllib.request.urlopen(url, timeout=30) as res:
            return res.read()

    def download_and_save_outputs(
        self, prompt_id: str, output_dir: Path, target_filename: Optional[str] = None
    ) -> List[Path]:
        """Download all generated output images for a prompt and save to disk."""
        history = self.get_history(prompt_id)
        prompt_data = history.get(prompt_id, {})
        outputs = prompt_data.get("outputs", {})
        saved_paths: List[Path] = []
        output_dir.mkdir(parents=True, exist_ok=True)

        for node_id, node_output in outputs.items():
            images = node_output.get("images", [])
            for idx, img_info in enumerate(images):
                filename = img_info["filename"]
                subfolder = img_info.get("subfolder", "")
                folder_type = img_info.get("type", "output")
                img_bytes = self.get_image(filename, subfolder, folder_type)

                if target_filename:
                    ext = Path(filename).suffix or ".png"
                    dest_name = f"{target_filename}{ext}" if not target_filename.endswith(ext) else target_filename
                    dest_path = output_dir / dest_name
                else:
                    dest_path = output_dir / filename

                with open(dest_path, "wb") as f:
                    f.write(img_bytes)
                saved_paths.append(dest_path)

        return saved_paths


if __name__ == "__main__":
    client = ComfyClient()
    online = client.is_online()
    print(f"ComfyUI server at {client.server_address} is {'ONLINE' if online else 'OFFLINE'}")

"""Generates the 5 DGGS biome textures via a local ComfyUI instance.

Prerequisites:
  - ComfyUI running locally (default: http://127.0.0.1:8000)
  - Z-Image-Turbo model files present: qwen_3_4b.safetensors (text encoder),
    z_image_turbo_bf16.safetensors (diffusion model), ae.safetensors (VAE)

Usage:
  python tools/generate_textures.py public/textures
"""

import json
import urllib.request
import urllib.parse
import time
import random
import sys
import os

COMFY_URL = "http://127.0.0.1:8000"


def build_prompt(text: str, seed: int, filename_prefix: str, width=1024, height=1024):
    return {
        "57:30": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2", "device": "default"},
        },
        "57:29": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "ae.safetensors"},
        },
        "57:28": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"},
        },
        "57:11": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"shift": 3, "model": ["57:28", 0]},
        },
        "57:27": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": text, "clip": ["57:30", 0]},
        },
        "57:33": {
            "class_type": "ConditioningZeroOut",
            "inputs": {"conditioning": ["57:27", 0]},
        },
        "57:13": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "57:3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": 8,
                "cfg": 1,
                "sampler_name": "res_multistep",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["57:11", 0],
                "positive": ["57:27", 0],
                "negative": ["57:33", 0],
                "latent_image": ["57:13", 0],
            },
        },
        "57:8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["57:3", 0], "vae": ["57:29", 0]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["57:8", 0], "filename_prefix": filename_prefix},
        },
    }


def queue_prompt(prompt):
    data = json.dumps({"prompt": prompt, "client_id": "dggs-texture-gen"}).encode("utf-8")
    req = urllib.request.Request(f"{COMFY_URL}/prompt", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def wait_for_result(prompt_id, timeout=120):
    start = time.time()
    while time.time() - start < timeout:
        with urllib.request.urlopen(f"{COMFY_URL}/history/{prompt_id}") as resp:
            hist = json.loads(resp.read())
        if prompt_id in hist:
            outputs = hist[prompt_id]["outputs"]
            for node_id, out in outputs.items():
                if "images" in out:
                    return out["images"]
        time.sleep(1)
    raise TimeoutError(f"Timed out waiting for prompt {prompt_id}")


def download_image(image_info, out_path):
    params = urllib.parse.urlencode(
        {"filename": image_info["filename"], "subfolder": image_info.get("subfolder", ""), "type": image_info["type"]}
    )
    with urllib.request.urlopen(f"{COMFY_URL}/view?{params}") as resp:
        with open(out_path, "wb") as f:
            f.write(resp.read())


# One entry per biome in src/dggs/icosahedron.ts's getBiomeForNormal.
TERRAINS = [
    ("calcite-polar-glade", "top-down photo texture of frost-covered pale blue-white icy ground, cracked calcite crystal frost, arctic tundra surface, flat even lighting, no shadows, seamless tileable texture, photorealistic, game texture"),
    ("basalt-abyssal-basin", "top-down photo texture of dark near-black volcanic basalt rock ground, deep sea abyssal basin floor, cracked dark stone, flat even lighting, no shadows, seamless tileable texture, photorealistic, game texture"),
    ("geodesic-moss-steppes", "top-down photo texture of green mossy steppe ground, lush moss and lichen covered rocky soil, grassy tundra, flat even lighting, no shadows, seamless tileable texture, photorealistic, game texture"),
    ("amber-quartz-plateau", "top-down photo texture of amber orange quartz crystal rock ground, sunlit desert plateau with orange mineral deposits, flat even lighting, no shadows, seamless tileable texture, photorealistic, game texture"),
    ("crystalline-crags", "top-down photo texture of cool gray crystalline rock ground, jagged crystal mineral formations, slate gray mountain crag surface, flat even lighting, no shadows, seamless tileable texture, photorealistic, game texture"),
]

if __name__ == "__main__":
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out_dir, exist_ok=True)

    for slug, prompt_text in TERRAINS:
        seed = random.randint(0, 2**32 - 1)
        prompt = build_prompt(prompt_text, seed, f"dggs-{slug}")
        print(f"Queuing {slug} (seed={seed})...")
        result = queue_prompt(prompt)
        prompt_id = result["prompt_id"]
        print(f"  prompt_id={prompt_id}, waiting...")
        images = wait_for_result(prompt_id)
        for i, img in enumerate(images):
            out_path = os.path.join(out_dir, f"{slug}.png" if i == 0 else f"{slug}_{i}.png")
            download_image(img, out_path)
            print(f"  saved -> {out_path}")

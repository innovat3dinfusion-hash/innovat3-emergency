"""
Generate 10 EMA voice samples for review.
5 female (different accents/tones) + 5 male.
Run: python assist/generate_voice_samples.py
"""
import asyncio, os, edge_tts

OUT = os.path.join(os.path.dirname(__file__), "voice-samples")
os.makedirs(OUT, exist_ok=True)

TEXT = (
    "Hi, I'm EMA — your Emergency Medical Assistant. "
    "Tap any card for instant guidance, or tell me what's happened "
    "and I'll help you through it."
)

VOICES = [
    # ── Female ────────────────────────────────────────────────────
    ("F1_Leah_SouthAfrican",  "en-ZA-LeahNeural",     "-5%",  "+0Hz"),
    ("F2_Natasha_Australian", "en-AU-NatashaNeural",   "-8%",  "-5Hz"),
    ("F3_Sonia_British",      "en-GB-SoniaNeural",     "-5%",  "+0Hz"),
    ("F4_Aria_American",      "en-US-AriaNeural",      "-5%",  "+0Hz"),
    ("F5_Emily_Irish",        "en-IE-EmilyNeural",     "-5%",  "+0Hz"),
    # ── Male ──────────────────────────────────────────────────────
    ("M1_Luke_SouthAfrican",  "en-ZA-LukeNeural",      "-5%",  "+0Hz"),
    ("M2_Ryan_British",       "en-GB-RyanNeural",      "-5%",  "+0Hz"),
    ("M3_Guy_American",       "en-US-GuyNeural",       "-5%",  "+0Hz"),
    ("M4_William_Australian", "en-AU-WilliamNeural",   "-5%",  "+0Hz"),
    ("M5_Abeo_WestAfrican",   "en-NG-AbeoNeural",      "-5%",  "+0Hz"),
]

async def make(name, voice, rate, pitch):
    path = os.path.join(OUT, name + ".mp3")
    comm = edge_tts.Communicate(TEXT, voice, rate=rate, pitch=pitch)
    await comm.save(path)
    print(f"OK  {name}  ({voice})")

async def main():
    print(f"Generating {len(VOICES)} samples -> {OUT}\n")
    for name, voice, rate, pitch in VOICES:
        await make(name, voice, rate, pitch)
    print("\nDone. Listen to the files in assist/voice-samples/ and pick your favourite.")

asyncio.run(main())

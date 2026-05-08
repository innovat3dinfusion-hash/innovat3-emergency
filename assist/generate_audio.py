"""
Generates pre-recorded audio files for the Innovat3 Medical Assistant.
Voice: en-ZA-LeahNeural  (South African English, Microsoft neural — free via edge-tts)
Run:   python3 generate_audio.py
Output: audio/*.mp3
"""

import asyncio
import os
import edge_tts

VOICE = "en-AU-NatashaNeural"

# Prosody: lower pitch = huskier; slower rate = soothing, sultry
RATE  = "-10%"   # relaxed — not rushed, not matronly
PITCH = "-7Hz"   # subtle drop only — keeps youth, adds a hint of husk
OUT   = os.path.join(os.path.dirname(__file__), "audio")
os.makedirs(OUT, exist_ok=True)

LINES = {
    "greeting": (
        "Hi, I'm Emma — your Emergency Medical Assistant. Ask me anything, or say find the nearest hospital. I've got you."
    ),
    "location_search": (
        "Sure. Let me find the nearest medical facilities for you right now. "
        "Please allow location access if your browser asks. "
        "And remember — for emergencies, call one zero one seven seven without delay."
    ),
    "heart_attack": (
        "This sounds like it could be a heart attack. Call one zero one seven seven immediately — do not drive there yourself. "
        "While you wait: sit or lay the person down comfortably and loosen any tight clothing. "
        "If they are not allergic, give them three hundred milligrams of aspirin to chew slowly — not to swallow whole. "
        "Do not give them anything else to eat or drink. "
        "Stay with them and watch their breathing. "
        "If they lose consciousness and stop breathing, begin CPR straight away."
    ),
    "stroke": (
        "This may be a stroke. Every second counts — call one zero one seven seven right now. "
        "Use the FAST test while you wait. "
        "F — check if one side of their face is drooping when they smile. "
        "A — ask them to raise both arms. Does one drift downward? "
        "S — listen to their speech. Is it slurred or confused? "
        "T — time is critical. If any of these are yes, call one zero one seven seven immediately. "
        "Do not give them food or water, and note the exact time symptoms started — the doctors will need this."
    ),
    "choking": (
        "Act quickly for a choking emergency. "
        "If they can still cough, encourage them to cough hard — that is the most effective way to clear the airway. "
        "If they cannot breathe or cough at all: lean them slightly forward and give five firm back blows between the shoulder blades using the heel of your hand. "
        "Then give five abdominal thrusts — place your fist just above their navel and push firmly inward and upward. "
        "Keep alternating back blows and thrusts until the object comes out. "
        "If they become unconscious, call one zero one seven seven and begin CPR immediately."
    ),
    "cpr": (
        "Call one zero one seven seven first, then begin CPR. "
        "Lay the person flat on their back on a firm surface. Tilt their head back gently and lift the chin. "
        "Check for breathing for up to ten seconds. "
        "If they are not breathing: place the heel of your hand on the centre of their chest. "
        "Push down firmly, five to six centimetres deep, at a rate of one hundred to one hundred and twenty compressions per minute — that is about the beat of Stayin Alive. "
        "After every thirty compressions, give two rescue breaths if you are trained to do so. "
        "If you are not trained, hands-only CPR — compressions without rescue breaths — is still very effective. "
        "Continue until the ambulance arrives."
    ),
    "bleeding": (
        "To control severe bleeding: apply firm, direct pressure to the wound immediately using the cleanest cloth you can find. "
        "Press hard and do not lift the cloth to check — this breaks the clot forming underneath. If it soaks through, add more cloth on top. "
        "If the wound is on an arm or leg, raise it above heart level to slow blood flow. "
        "For life-threatening bleeding that will not stop: apply a tourniquet about five centimetres above the wound and note the exact time you applied it — this is critical for the medical team. "
        "Call one zero one seven seven if the bleeding is severe, spurting, or does not slow within ten minutes."
    ),
    "seizure": (
        "During a seizure, stay calm. Do not try to restrain the person — this can cause injury. "
        "Clear any hard or sharp objects from around them. Place something soft under their head. "
        "Gently roll them onto their side into the recovery position to keep the airway clear. "
        "Time how long the seizure lasts — this is important. "
        "Do not put anything into their mouth. "
        "Call one zero one seven seven if: the seizure lasts more than five minutes, "
        "they do not regain consciousness, they are injured, or it is their first ever seizure."
    ),
    "burns": (
        "For a burn injury: remove the person from the heat source immediately. "
        "Then cool the burn under cool — not cold — running water for a full twenty minutes. Please do not use ice, butter, or toothpaste — these cause more damage. "
        "Remove any jewellery or clothing near the burned area, but only if it is not stuck to the skin. "
        "Cover the burn loosely with cling wrap or a clean cloth. "
        "Go to the emergency room if the burn is larger than the palm of your hand, "
        "if it is on the face, hands, feet, or groin, if the skin appears white or charred, "
        "or if it was caused by a chemical or electricity."
    ),
    "allergic": (
        "This sounds like a severe allergic reaction — possibly anaphylaxis. Call one zero one seven seven immediately. "
        "Signs to watch for: swelling of the throat or tongue, difficulty breathing, faintness, or pale skin. "
        "Lay the person flat and raise their legs — unless they are struggling to breathe, in which case help them sit upright. "
        "If they have an EpiPen or adrenaline auto-injector, use it now in the outer thigh — even through clothing is fine. "
        "A second EpiPen can be used after five minutes if there is no improvement. "
        "Do not leave them alone, and do not give antihistamines as a substitute for the EpiPen in severe reactions."
    ),
    "overdose": (
        "For a suspected poisoning or overdose: call the South African Poison Helpline on zero eight hundred, three three three, four four four. "
        "Or call one zero one seven seven for emergency assistance. "
        "Try to find out what was taken and approximately when — keep any packaging or containers to show the medics. "
        "Do not induce vomiting unless the Poison Helpline specifically tells you to. "
        "If the person is unconscious but breathing, place them in the recovery position on their side. "
        "If they are not breathing, begin CPR and call one zero one seven seven immediately. "
        "If a chemical has contacted the skin or eyes, flush with large amounts of clean water for fifteen to twenty minutes."
    ),
    "fever": (
        "A fever in adults is a temperature of thirty-eight degrees Celsius or higher. "
        "Give paracetamol — such as Panado — or ibuprofen according to the package instructions. "
        "Encourage the person to drink fluids regularly to prevent dehydration. "
        "Tepid sponging with lukewarm water can help bring the temperature down. Keep them in a cool, well-ventilated room. "
        "Please see a doctor or go to emergency if: "
        "the fever is above thirty-nine point five degrees in an adult, "
        "there is any fever at all in a baby under three months, "
        "the fever is accompanied by a stiff neck, skin rash, confusion, or seizures, "
        "or if the fever has lasted more than three days."
    ),
    "diabetic": (
        "This sounds like low blood sugar — also called hypoglycaemia — which is common in diabetic emergencies. "
        "Signs include shaking, sweating, confusion, pale skin, and a rapid heartbeat. "
        "If the person is conscious and able to swallow: give them fifteen grams of fast-acting sugar right away. "
        "That could be three glucose tablets, one hundred and fifty millilitres of fruit juice, or three teaspoons of sugar dissolved in water. "
        "Wait fifteen minutes, then give a light snack such as bread or a few biscuits to stabilise their sugar. "
        "If the person is unconscious: do not give anything by mouth. "
        "Place them in the recovery position and call one zero one seven seven immediately."
    ),
    "help": (
        "Of course. I can guide you through these medical emergencies: "
        "heart attack and chest pain, stroke using the FAST test, choking and the Heimlich manoeuvre, "
        "CPR for an unconscious person, severe bleeding, seizures, burns and scalds, "
        "severe allergic reactions and anaphylaxis, overdose and poisoning, "
        "fever management, and diabetic low blood sugar emergencies. "
        "You can also tap the Find Nearby Facilities button to locate the nearest hospital, pharmacy, or clinic. "
        "Just ask me about any of these and I will walk you through it step by step."
    ),
    "default": (
        "I'm Emma. Ask me about any emergency — or say find the nearest hospital and I'll sort it."
    ),
}

async def generate_one(key, text):
    path = os.path.join(OUT, f"{key}.mp3")
    communicate = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
    await communicate.save(path)
    size = os.path.getsize(path)
    print(f"  OK  {key}.mp3  ({size // 1024} KB)")

async def main():
    print(f"\nGenerating {len(LINES)} audio files using {VOICE}...\n")
    for key, text in LINES.items():
        await generate_one(key, text)
    print(f"\nDone! Files saved to: {OUT}\n")

asyncio.run(main())

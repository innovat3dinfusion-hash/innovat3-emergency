"""
Generates pre-recorded audio files for EMA — Emergency Medical Assistant.
Voice: en-IE-EmilyNeural  (Irish English, Microsoft Neural — free via edge-tts)
Run:   python assist/generate_audio.py
Output: assist/audio/*.mp3
"""

import asyncio
import os
import edge_tts

VOICE = "en-IE-EmilyNeural"
RATE  = "-5%"
PITCH = "+0Hz"
OUT   = os.path.join(os.path.dirname(__file__), "audio")
os.makedirs(OUT, exist_ok=True)

LINES = {
    "greeting": (
        "Hi, I'm Emma — and I'm here to help. "
        "Just tap a card or tell me what's happening, and I'll walk you through it."
    ),
    "default": (
        "I'm Emma. Tell me what's happening and I'll help — or tap Find Nearest to locate the closest hospital or doctor."
    ),
    "location_search": (
        "Of course — let me find the nearest hospitals and doctors for you right now. "
        "Go ahead and allow location access if your phone asks. "
        "And remember — for any emergency, call one zero one seven seven straight away."
    ),
    "heart_attack": (
        "This sounds like it could be a heart attack. Call one zero one seven seven immediately — do not drive there yourself. "
        "Sit or lay the person down comfortably and loosen any tight clothing. "
        "If they are not allergic to aspirin, give them three hundred milligrams to chew slowly. "
        "Do not give them anything else to eat or drink. "
        "Stay with them and watch their breathing. "
        "If they lose consciousness and stop breathing, begin CPR straight away."
    ),
    "stroke": (
        "This may be a stroke — every second counts. Call one zero one seven seven right now. "
        "Use the FAST test while you wait. "
        "F — check if one side of their face is drooping. "
        "A — ask them to raise both arms. Does one drift downward? "
        "S — is their speech slurred or confused? "
        "T — time is critical. If any answer is yes, call one zero one seven seven immediately. "
        "Do not give them food or water, and note the exact time symptoms started."
    ),
    "choking": (
        "Act quickly for a choking emergency. "
        "If they can still cough, encourage them to cough hard — that is the most effective way to clear the airway. "
        "If they cannot breathe or cough: lean them forward and give five firm back blows between the shoulder blades using the heel of your hand. "
        "Then give five abdominal thrusts — fist just above the navel, push firmly inward and upward. "
        "Keep alternating until the object clears. "
        "If they become unconscious, call one zero one seven seven and begin CPR immediately."
    ),
    "cpr": (
        "Call one zero one seven seven first, then begin CPR. "
        "Lay the person flat on a firm surface. Tilt their head back gently and lift the chin. "
        "Check for breathing for up to ten seconds. "
        "If they are not breathing: place the heel of your hand on the centre of their chest. "
        "Push down five to six centimetres deep at one hundred to one hundred and twenty compressions per minute — about the beat of Stayin Alive. "
        "After every thirty compressions, give two rescue breaths if you are trained. "
        "If not trained, compressions only is still very effective. "
        "Continue until the ambulance arrives."
    ),
    "bleeding": (
        "Apply firm, direct pressure to the wound immediately using the cleanest cloth available. "
        "Press hard and do not lift the cloth — this breaks the clot forming underneath. If it soaks through, add more on top. "
        "If the wound is on a limb, raise it above heart level to slow the bleeding. "
        "For life-threatening bleeding that will not stop, apply a tourniquet five centimetres above the wound and note the exact time. "
        "Call one zero one seven seven if the bleeding is severe, spurting, or does not slow."
    ),
    "seizure": (
        "During a seizure, stay calm. Do not restrain the person. "
        "Clear any hard or sharp objects away. Place something soft under their head. "
        "Gently roll them onto their side to keep the airway clear. "
        "Time the seizure — this is important for the medical team. "
        "Do not put anything in their mouth. "
        "Call one zero one seven seven if it lasts more than five minutes, they do not regain consciousness, or it is their first seizure."
    ),
    "burns": (
        "Remove the person from the heat source. "
        "Cool the burn under cool — not cold — running water for a full twenty minutes. "
        "Do not use ice, butter, or toothpaste — these cause more damage. "
        "Remove jewellery or clothing near the burn, but only if it is not stuck to the skin. "
        "Cover loosely with cling wrap or a clean cloth. "
        "Go to emergency if the burn is larger than the palm of your hand, on the face, hands, or groin, appears white or charred, or was caused by a chemical or electricity."
    ),
    "allergic": (
        "This sounds like a severe allergic reaction — possibly anaphylaxis. Call one zero one seven seven immediately. "
        "Watch for swelling of the throat or tongue, difficulty breathing, faintness, or pale skin. "
        "Lay the person flat and raise their legs — unless they are struggling to breathe, in which case sit them upright. "
        "If they have an EpiPen, use it now in the outer thigh — through clothing is fine. "
        "A second dose can be given after five minutes if needed. "
        "Do not substitute antihistamines for the EpiPen in a severe reaction."
    ),
    "overdose": (
        "Call the South African Poison Helpline on zero eight hundred three three three four four four, or one zero one seven seven for emergencies. "
        "Find out what was taken and when — keep any packaging for the medics. "
        "Do not induce vomiting unless specifically told to by the helpline. "
        "If unconscious but breathing, place them on their side in the recovery position. "
        "If not breathing, begin CPR and call one zero one seven seven immediately."
    ),
    "fever": (
        "Give paracetamol or ibuprofen according to the package instructions, and encourage plenty of fluids. "
        "Tepid sponging with lukewarm water can help. Keep them in a cool, ventilated room. "
        "See a doctor urgently if the fever is above thirty-nine point five in an adult, "
        "any fever in a baby under three months, "
        "or if it is accompanied by a stiff neck, rash, confusion, or seizures."
    ),
    "diabetic": (
        "This sounds like low blood sugar — hypoglycaemia. "
        "If the person is conscious and can swallow: give fifteen grams of fast-acting sugar right away — "
        "three glucose tablets, one fifty millilitres of fruit juice, or three teaspoons of sugar in water. "
        "Wait fifteen minutes, then give a light snack to stabilise. "
        "If they are unconscious: do not give anything by mouth. "
        "Place them on their side and call one zero one seven seven immediately."
    ),
    "help": (
        "I can guide you through these emergencies: "
        "heart attack, stroke, choking, CPR, severe bleeding, seizures, burns, "
        "allergic reactions, overdose, fever, diabetic emergencies, "
        "hijacking, drowning, burglary, electric shock, snake bite, "
        "asthma attack, broken bones, heat stroke, panic attack, and gunshot wounds. "
        "Tap any card above or ask me directly and I will walk you through it."
    ),
    "hijacking": (
        "If you are being hijacked — do not resist. Comply with all demands. "
        "Keep your hands visible and make no sudden movements. "
        "If they want the car, step out slowly and move away from the vehicle. "
        "Observe as much as you can — the car, direction, and any descriptions — but stay safe first. "
        "Once you are safe, call one zero one one one to report it."
    ),
    "drowning": (
        "Call one zero one seven seven immediately. "
        "Do not jump in unless you are trained in water rescue — you could become a second victim. "
        "Throw something for them to grab — a rope, life ring, or any floating object. "
        "Once they are out of the water, check their breathing. "
        "If they are not breathing, begin CPR straight away. "
        "Even if they seem fine, take them to hospital — delayed complications from water in the lungs can be fatal."
    ),
    "burglary": (
        "Do not confront the intruder. "
        "If you think they may still be inside, leave immediately and call one zero one one one from a safe location. "
        "If you are trapped, lock yourself in a room and call one zero one one one quietly if you can. "
        "Do not touch anything after — preserve the scene for the police. "
        "If anyone is injured, call one zero one seven seven."
    ),
    "electrocution": (
        "Do not touch them — you could be electrocuted too. "
        "Switch off the power at the mains first. "
        "If that is not possible, use a dry wooden object or thick plastic to push the source away — never use metal. "
        "Once they are free, call one zero one seven seven. "
        "Check their breathing and begin CPR if needed. "
        "Cool any burns with running water. "
        "They must go to hospital even if they appear fine — internal injuries from electricity are not always visible."
    ),
    "snake_bite": (
        "Keep them as still as possible — movement spreads venom faster. "
        "Call one zero one seven seven or the Poison Helpline on zero eight hundred three three three four four four. "
        "Keep the bitten limb below heart level. "
        "Remove rings, watches, and tight clothing near the bite. "
        "Do not cut, suck, tourniquet, or apply ice to the wound. "
        "If it is safe to do so, take a photo of the snake from a distance to help identify it. "
        "Get to hospital immediately."
    ),
    "asthma": (
        "Sit them upright, leaning slightly forward — do not lay them down. "
        "Use the reliever inhaler — the blue one — one puff every thirty to sixty seconds, up to ten puffs. "
        "Loosen any tight clothing and encourage slow, steady breathing. "
        "Call one zero one seven seven if: there is no improvement after ten minutes, "
        "they cannot speak in full sentences, or their lips begin to turn blue."
    ),
    "broken_bone": (
        "Do not try to move or straighten the limb. Immobilise it in the position you find it. "
        "Use rolled clothing, a pillow, or padding to support it. "
        "If bone is visible through the skin, cover it loosely — do not push it back. "
        "Apply a wrapped ice pack to reduce swelling. "
        "If you suspect the spine, hip, or pelvis is injured, do not move them at all. "
        "Call one zero one seven seven."
    ),
    "heat_stroke": (
        "Call one zero one seven seven immediately — heat stroke is life-threatening. "
        "Move them to the coolest available shade and remove excess clothing. "
        "Cool them down as fast as possible: apply wet cloths to the neck, armpits, and groin, and fan them vigorously. "
        "If they are conscious, give small sips of cool water. "
        "Do not give fluids if they are confused or unconscious. "
        "Place them in the recovery position if unconscious and keep cooling until help arrives."
    ),
    "panic_attack": (
        "Stay with them and speak calmly. Remind them that this will pass and that they are safe. "
        "Breathe with them — in for four counts, hold for two, out for six. "
        "Help ground them: ask them to feel their feet on the floor, or hold something solid in their hands. "
        "Do not tell them to calm down — it rarely helps. "
        "If this is their first episode, or if they have severe chest pain, take them to emergency to rule out other causes."
    ),
    "gunshot": (
        "Call one zero one seven seven immediately. "
        "Make sure the area is safe before approaching — do not move into an active threat. "
        "Apply firm pressure to the wound with the cleanest cloth available and press hard. Do not lift the cloth. "
        "If the chest wound makes a sucking sound, seal three sides with plastic or a clean cloth to allow air out but not in. "
        "Do not remove any embedded objects. "
        "Maintain pressure until paramedics arrive."
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
    print(f"\nDone. Files saved to: {OUT}\n")

asyncio.run(main())

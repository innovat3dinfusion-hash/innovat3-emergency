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
        "Hi — I am your Emergency Medical Assistant, or Emma for short. "
        "Ask me for assistance."
    ),
    "default": (
        "I'm Emma. Tell me what's happening and I'll help — "
        "or tap Find Nearest to locate the closest hospital or doctor."
    ),
    "location_search": (
        "Let me find the nearest hospitals and doctors for you right now. "
        "Allow location access if your phone asks."
    ),
    "heart_attack": (
        "Sit or lay them down and loosen any tight clothing. "
        "If they are not allergic to aspirin, give them three hundred milligrams to chew slowly — not swallow whole. "
        "Do not give food or drink. "
        "Keep them still and watch their breathing closely. "
        "If they lose consciousness and stop breathing, start CPR. "
        "Call for an ambulance now."
    ),
    "stroke": (
        "Use the FAST check. "
        "Face — is one side drooping when they smile? "
        "Arms — does one drift down when both are raised? "
        "Speech — is it slurred or confused? "
        "If any of these are yes, note the exact time it started and get them to hospital immediately — "
        "do not give food or water."
    ),
    "choking": (
        "If they can still cough, encourage hard coughing — it's the most effective. "
        "If they cannot breathe: lean them forward and give five firm back blows between the shoulder blades with the heel of your hand. "
        "Then five abdominal thrusts — fist just above the navel, push firmly inward and upward. "
        "Keep alternating until the object clears. "
        "If they go unconscious, start CPR."
    ),
    "cpr": (
        "Lay them flat on a firm surface. Tilt the head back and lift the chin. "
        "Check for breathing for up to ten seconds. "
        "Place the heel of your hand on the centre of the chest. "
        "Push down five to six centimetres deep — one hundred to one hundred and twenty times per minute. "
        "That is about the beat of Stayin Alive. "
        "After thirty compressions, give two rescue breaths if you are trained. "
        "Compressions only is still effective if you are not trained. "
        "Keep going until help arrives."
    ),
    "bleeding": (
        "Press firmly on the wound with the cleanest cloth you have — and do not lift it. "
        "If it soaks through, add more cloth on top. "
        "Raise a wounded limb above heart level to slow blood flow. "
        "For severe bleeding that won't stop, apply a tourniquet five centimetres above the wound "
        "and note the time you applied it."
    ),
    "seizure": (
        "Do not restrain them — let it happen. "
        "Clear hard or sharp objects away and place something soft under their head. "
        "Roll them gently onto their side once it eases. "
        "Time how long it lasts — the medical team will need this. "
        "Do not put anything in their mouth. "
        "If it goes beyond five minutes or they do not wake up, call for an ambulance."
    ),
    "burns": (
        "Move them away from the heat source. "
        "Cool the burn under cool — not cold — running water for twenty minutes. "
        "No ice, butter, or toothpaste — these cause more damage. "
        "Remove jewellery or clothing near the burn only if it is not stuck to the skin. "
        "Cover loosely with cling wrap or a clean cloth. "
        "Go to emergency if the burn is larger than the palm of your hand, "
        "on the face, hands or groin, or looks white or charred."
    ),
    "allergic": (
        "This may be anaphylaxis. "
        "Lay them flat and raise their legs — unless they are struggling to breathe, then sit them upright. "
        "If they have an EpiPen, use it immediately in the outer thigh — through clothing is fine. "
        "A second dose can be given after five minutes if there is no improvement. "
        "Do not use antihistamines as a substitute for the EpiPen. "
        "Get them to hospital even if they improve."
    ),
    "overdose": (
        "Find out what was taken, how much, and when — keep any packaging for the medics. "
        "Do not induce vomiting unless told to by a professional. "
        "If unconscious but breathing, roll them onto their side. "
        "If not breathing, start CPR. "
        "For poison queries, the Poison Helpline is zero eight hundred, three three three, four four four."
    ),
    "fever": (
        "Give paracetamol or ibuprofen at the correct dose and encourage fluids. "
        "Tepid sponging helps bring the temperature down. Keep them in a cool, ventilated room. "
        "See a doctor if the fever is above thirty-nine point five degrees, "
        "there is any fever in a baby under three months, "
        "or if it comes with a stiff neck, rash, or confusion."
    ),
    "diabetic": (
        "This looks like low blood sugar. "
        "If conscious and able to swallow — give sugar immediately. "
        "Three glucose tablets, a hundred and fifty millilitres of juice, or three teaspoons of sugar in water. "
        "Wait fifteen minutes, then give a small snack to keep it stable. "
        "If unconscious — do not give anything by mouth. Roll them onto their side and call for an ambulance."
    ),
    "help": (
        "I can help with: heart attack, stroke, choking, CPR, bleeding, seizures, burns, "
        "allergic reactions, overdose, fever, diabetic emergencies, "
        "hijacking, drowning, burglary, electric shock, snake bite, "
        "asthma, broken bones, heat stroke, panic attack, and gunshot wounds. "
        "Tap any card or ask me directly."
    ),
    "hijacking": (
        "Do not resist — comply with every demand. "
        "Hands visible, no sudden movements. "
        "If they want the car, step out slowly and walk away from it. "
        "Remember as much as you can — the car, direction, descriptions. "
        "Once you are safe, report it to the police."
    ),
    "drowning": (
        "Do not jump in unless you are trained in water rescue. "
        "Throw something they can grab — a rope, ring, or any floating object. "
        "Once out, check their breathing. "
        "Not breathing — start CPR immediately. "
        "Even if they seem fine, take them to hospital. "
        "Delayed lung complications from water can be fatal. Call for an ambulance."
    ),
    "burglary": (
        "Do not confront the intruder. "
        "If they may still be inside, leave immediately and call from a safe place. "
        "If you are trapped, lock yourself in a room and call quietly. "
        "Do not touch anything after — preserve the scene. "
        "If anyone is injured, call for an ambulance."
    ),
    "electrocution": (
        "Do not touch them — you risk being electrocuted too. "
        "Switch off the power at the mains first. "
        "If you cannot, push the source away with dry wood or thick plastic — never metal. "
        "Once they are free, check breathing and start CPR if needed. "
        "Cool any burns with running water. "
        "They must go to hospital even if they seem fine — electrical injuries are not always visible."
    ),
    "snake_bite": (
        "Keep them completely still — movement spreads venom faster. "
        "Keep the bitten limb below heart level. "
        "Remove rings, watches, and tight clothing near the bite. "
        "Do not cut, suck, tourniquet, or apply ice. "
        "Photo the snake from a safe distance if possible — it helps with treatment. "
        "Get to hospital immediately. "
        "The Poison Helpline is zero eight hundred, three three three, four four four."
    ),
    "asthma": (
        "Sit them upright, leaning slightly forward. Do not lay them down. "
        "Use the blue reliever inhaler — one puff every thirty to sixty seconds, up to ten puffs. "
        "Loosen any tight clothing and encourage slow, steady breathing. "
        "If there is no improvement after ten minutes, "
        "they cannot speak in full sentences, or their lips go blue — call for an ambulance."
    ),
    "broken_bone": (
        "Do not move or straighten the limb. Immobilise it exactly where it is. "
        "Use rolled clothing or padding to support it. "
        "If bone is through the skin, cover it loosely — do not push it back. "
        "Apply a wrapped ice pack to reduce swelling. "
        "If the spine, hip, or pelvis may be involved, do not move them at all."
    ),
    "heat_stroke": (
        "This is life-threatening — act fast. "
        "Move them to the coolest shade available and remove excess clothing. "
        "Cool them immediately: wet cloths on the neck, armpits, and groin, and fan hard. "
        "Small sips of cool water if they are conscious. "
        "No fluids if confused or unconscious. "
        "Recovery position if unconscious. Keep cooling until the ambulance arrives."
    ),
    "fainting": (
        "Lay them flat on their back and raise their legs about twenty centimetres — "
        "this restores blood flow to the brain. "
        "Loosen any tight clothing and make sure they can breathe normally. "
        "Do not give food or water until they are fully alert. "
        "If they do not come around within two minutes, or they are not breathing, call for an ambulance."
    ),
    "panic_attack": (
        "Stay with them and speak calmly — remind them it will pass and they are safe. "
        "Breathe together: in for four, hold for two, out for six. "
        "Help them ground themselves — feel their feet on the floor, hold something solid. "
        "Do not say calm down. "
        "If this is their first episode or there is chest pain, go to emergency."
    ),
    "gunshot": (
        "Make sure the area is safe before approaching. "
        "Apply firm pressure to the wound with the cleanest cloth available — press hard and do not lift it. "
        "If the chest makes a sucking sound, seal three sides of the wound with plastic to let air out but not in. "
        "Do not remove anything embedded. "
        "Maintain pressure until paramedics arrive. Call for an ambulance now."
    ),
    "nosebleed": (
        "Lean them slightly forward and pinch the soft part of the nose just below the bone. "
        "Hold firm for ten minutes without releasing. "
        "Do not tilt the head back — it sends blood down the throat. "
        "Breathe through the mouth. "
        "If it does not stop after twenty minutes, or it followed a head injury, seek medical attention."
    ),
    "concussion": (
        "Do not leave them alone. "
        "Watch closely for: confusion, repeated vomiting, unequal pupils, or a worsening headache — "
        "these are signs of a serious brain injury. "
        "Keep them calm and still. No food or water until assessed. "
        "They must see a doctor even if they feel fine — symptoms can appear hours later."
    ),
    "sprain": (
        "Rest the injured area immediately — stop all activity. "
        "Apply a wrapped ice pack for twenty minutes every two hours. "
        "Compress with a bandage — firm but not tight enough to cut circulation. "
        "Elevate the limb above heart level to reduce swelling. "
        "If there is severe swelling, visible deformity, or they cannot bear any weight, treat as a possible fracture."
    ),
    "eye_injury": (
        "Do not rub the eye — this causes further damage. "
        "For a chemical splash: flush with clean running water continuously for fifteen minutes. "
        "For a foreign object: do not try to remove it. Cover loosely with a clean cloth without applying pressure. "
        "For any puncture or cut to the eyeball: cover both eyes and go to emergency immediately."
    ),
    "dental": (
        "For a knocked-out tooth: handle by the crown only — never the root. "
        "Rinse very gently without scrubbing. "
        "Re-insert into the socket if possible, or store in milk or between the cheek and gum. "
        "Get to a dentist within thirty minutes — speed is critical. "
        "For a severe toothache with facial swelling, see a dentist urgently — it may be an abscess."
    ),
    "vomiting": (
        "Sit them upright or lean them forward to prevent choking. "
        "If lying down, roll them onto their side. "
        "Give small sips of water only once vomiting eases — not large amounts. "
        "Seek urgent care if vomit contains blood, there is severe abdominal pain, "
        "it follows a head injury, or it does not stop after several hours."
    ),
    "dehydration": (
        "Give small, frequent sips of water or an oral rehydration solution. "
        "Do not give large amounts at once — this causes further vomiting. "
        "Move to a cool environment and rest. "
        "Get medical help if the person is confused, has not urinated in eight hours, "
        "or is an infant or elderly."
    ),
    "hypothermia": (
        "Move them to warmth immediately and remove any wet clothing. "
        "Cover with dry blankets, including the head. "
        "Warm slowly — do not apply direct heat such as hot water or a heating pad. "
        "Give warm sweet drinks only if they are fully conscious. "
        "Handle very gently — sudden movement can trigger cardiac arrest."
    ),
    "dizziness": (
        "Sit or lay them down immediately to prevent a fall. "
        "Loosen any tight clothing and allow fresh air. "
        "If it passes, have them rise very slowly. "
        "See a doctor if dizziness is severe, recurring, "
        "or comes with chest pain, hearing loss, or follows a head injury."
    ),
    "pregnancy": (
        "Keep them calm and help them into the most comfortable position. "
        "Time contractions from the start of one to the start of the next. "
        "Call for help if contractions are five minutes apart or less, "
        "there is heavy bleeding, the waters break, or they feel the urge to push. "
        "Do not leave them alone."
    ),
    "allergic_mild": (
        "For a mild reaction with hives or itching, "
        "give an antihistamine such as Cetirizine or Loratadine at the correct dose. "
        "Watch closely for thirty minutes. "
        "If symptoms progress to throat tightness, difficulty breathing, or dizziness, "
        "this is anaphylaxis — use the EpiPen immediately."
    ),
    "abdominal": (
        "Do not give food, water, or pain medication until a doctor has assessed them. "
        "Help them into the most comfortable position — usually lying with knees drawn up. "
        "Get urgent care if the abdomen is rigid or board-hard, "
        "the pain came on suddenly and severely, there is fever with the pain, "
        "or they are vomiting blood."
    ),
    "not_found": (
        "I don't have specific guidance for that scenario. "
        "For any life-threatening emergency, call ten one seven seven immediately. "
        "You can also tap one of the emergency cards for guidance on common emergencies."
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

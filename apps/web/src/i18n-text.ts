// Hindi for the sentences, hints, tooltips and statuses of the screens. Keyed by the exact English
// text the screen passes to <T> or bilingual(); {name} marks a place where the screen puts a value
// (a nickname, a count, a file name). Written for this app and not yet read by a native speaker.
export const HI_TEXT: Record<string, string> = {
  // notices and failures
  "You're in.": "आप भीतर हैं।",
  "Something went wrong.": "कुछ गड़बड़ हो गई।",
  "Can't reach the table. Check your connection.": "पटल तक नहीं पहुँच पा रहे। अपना कनेक्शन जाँचें।",
  "There is nothing to undo yet.": "पूर्ववत करने को अभी कुछ नहीं है।",
  "A new chapter begins.": "एक नया अध्याय आरंभ होता है।",
  "Looking for plot points…": "कथानक-बिंदु खोजे जा रहे हैं…",

  // questions and choices
  OK: "ठीक है",
  Begin: "आरंभ",
  "No particular part": "कोई विशेष भूमिका नहीं",
  "Someone in the story": "कथा का कोई पात्र",
  Companion: "साथी",
  Antagonist: "विरोधी",
  "Starting character": "आरंभिक पात्र",
  "fog, mist, haze": "कोहरा, धुंध, गुबार",
  "gothic, sea": "गॉथिक, समुद्र",
  "cozy, eerie": "आरामदायक, रहस्यमय",
  "Part in the story": "कथा में भूमिका",

  // the demo storyteller's scripted reply
  "The lamp gutters. Somewhere beyond the glass, something large turns over in its sleep. (This is the demo storyteller; connect a model to hear the real one.) What do you do?":
    "दीप टिमटिमाता है। शीशे के उस पार कहीं कोई विशाल चीज़ नींद में करवट बदलती है। (यह डेमो कथावाचक है; असली कथावाचक को सुनने के लिए कोई मॉडल जोड़ें।) आप क्या करते हैं?",

  // connection, the window's chip and small statuses
  "Chapter {n}": "अध्याय {n}",
  Chapters: "अध्याय",
  Connected: "जुड़ा है",
  "Connection lost. Trying again…": "संपर्क टूट गया। फिर प्रयास हो रहा है…",
  "Connecting…": "जुड़ रहा है…",
  "writing…": "लिखा जा रहा है…",
  story: "कथा",
  Untitled: "बिना शीर्षक",
  hushed: "चुप कराया गया",
  "The host": "यजमान",
  "A reply broke a rule ({text}).": "एक उत्तर ने नियम तोड़ा ({text})।",
  "Something went wrong ({n}).": "कुछ गड़बड़ हो गई ({n})।",

  // header and jump box
  "Open a world to jump to its cards as well.": "इसके पत्रकों पर भी जाने के लिए कोई संसार खोलें।",
  World: "संसार",

  // joining and waiting
  "Join the table": "पटल पर आएँ",
  "{host} is hosting. Pick a name to come in; you can watch first and join in whenever you like.":
    "{host} यजमान हैं। भीतर आने के लिए नाम चुनें; पहले देख सकते हैं और जब चाहें सम्मिलित हो सकते हैं।",
  "Pick a name to come in.": "भीतर आने के लिए नाम चुनें।",
  "Up to 24 letters or digits, no spaces.": "24 अक्षर या अंक तक, रिक्त स्थान नहीं।",
  "I am an adult (18 or older). This story is for adult readers.":
    "मैं वयस्क हूँ (18 या अधिक)। यह कथा वयस्क पाठकों के लिए है।",
  "Come in": "भीतर आएँ",
  "Accept your invitation": "अपना आमंत्रण स्वीकार करें",
  "This invitation is for {email}. Choose a password to finish.":
    "यह आमंत्रण {email} के लिए है। पूरा करने के लिए गुप्तशब्द चुनें।",
  Password: "गुप्तशब्द",
  "At least 8 characters.": "कम से कम 8 अक्षर।",
  "Password again": "गुप्तशब्द फिर से",
  "The two passwords are different.": "दोनों गुप्तशब्द अलग-अलग हैं।",
  "I am an adult (18 or older). This world is for adult readers.":
    "मैं वयस्क हूँ (18 या उससे अधिक)। यह संसार वयस्क पाठकों के लिए है।",
  "Working…": "काम हो रहा है…",
  "Try again": "पुनः प्रयास करें",
  "Create my account": "मेरा खाता बनाएँ",
  "Sign in": "प्रवेश करें",
  "Sign out": "बाहर निकलें",
  Database: "आँकड़ा-भंडार",
  "Loading this asset…": "यह सामग्री खुल रही है…",
  "Saving…": "सहेजा जा रहा है…",
  "Prompt saved": "संकेत सहेजा गया",
  "Could not save the prompt": "संकेत सहेजा नहीं जा सका",
  "Reference images": "संदर्भ-चित्र",
  "The ticked sprites are the starting point: this one is made from them, so the character stays the same.":
    "चिह्नित आकृतियाँ आरंभ-बिंदु हैं: यह उन्हीं से बनती है, इसलिए पात्र वही रहता है।",
  "The ticked sprites show the image who is in it. Tick one sprite per character.":
    "चिह्नित आकृतियाँ चित्र को बताती हैं कि उसमें कौन है। हर पात्र की एक आकृति चिह्नित करें।",
  "No other sprites exist yet.": "अभी कोई और आकृति नहीं है।",
  Files: "फ़ाइलें",
  "Cards are kept in the database. Edits here are saved there; the folder copy is not used.":
    "पत्र आँकड़ा-भंडार में रखे हैं। यहाँ के सुधार वहीं सहेजे जाते हैं; फ़ोल्डर की प्रति काम में नहीं ली जाती।",
  "Cards are read from this world's folder. Import the world to keep them in the database.":
    "पत्र इस संसार के फ़ोल्डर से पढ़े जाते हैं। उन्हें आँकड़ा-भंडार में रखने के लिए संसार आयात करें।",
  "Have an account? Sign in.": "खाता है? प्रवेश करें।",
  "Signing in…": "प्रवेश हो रहा है…",
  Email: "ईमेल",
  "Coming in…": "भीतर आ रहे हैं…",
  "Running the server? Open the link it printed in your terminal to take the host's seat.":
    "सर्वर चला रहे हैं? यजमान का आसन लेने के लिए टर्मिनल में छपा लिंक खोलें।",
  "The story": "कथा",
  "Waiting for the host": "यजमान की प्रतीक्षा",
  "Drag it by its title bar to put it where you like, or minimize it to a chip in the corner and open it again from there.":
    "इसे शीर्ष-पट्टी से खींचकर जहाँ चाहें रखें, या छोटा करके कोने में चिप बना दें और वहीं से फिर खोलें।",
  "{host} is choosing a story. It will appear here the moment it begins.":
    "{host} कथा चुन रहे हैं। आरंभ होते ही वह यहाँ दिखेगी।",
  "{host} hasn't chosen a world yet. You're in; this will fill in on its own.":
    "{host} ने अभी संसार नहीं चुना। आप भीतर हैं; यह अपने आप भर जाएगा।",

  // the story window
  Minimize: "छोटा करें",
  Restore: "पहले जैसा करें",
  "Fill the page": "पूरा पृष्ठ भरें",

  // the story
  "{n} chapter written": "{n} अध्याय लिखा गया",
  "{n} chapters written": "{n} अध्याय लिखे गए",
  "Saved automatically as {id}": "{id} के रूप में अपने आप संचित",
  "Write a different reply": "कोई और उत्तर लिखें",
  "Let the story go on": "कथा को आगे चलने दें",
  "Take back the last turn": "पिछली बारी वापस लें",
  "Save as a new world…": "नए संसार के रूप में संचित करें…",
  "Start a new chapter…": "नया अध्याय आरंभ करें…",
  "Name the next chapter (or leave blank):": "अगले अध्याय का नाम दें (या खाली छोड़ें):",
  "“{title}” is in your library, with {cards} cards.":
    "“{title}” आपके संग्रह में है, {cards} पत्रकों के साथ।",
  "“{title}” is in your library, with {cards} cards and {chapters} chapter.":
    "“{title}” आपके संग्रह में है, {cards} पत्रकों और {chapters} अध्याय के साथ।",
  "“{title}” is in your library, with {cards} cards and {chapters} chapters.":
    "“{title}” आपके संग्रह में है, {cards} पत्रकों और {chapters} अध्यायों के साथ।",
  "Everything that happened in this story is now part of that world. The original is untouched.":
    "इस कथा में जो कुछ हुआ, वह अब उस संसार का अंग है। मूल अछूता है।",
  "Keeps this story's cards, with everything that has happened written into them, and its chapters. New stories you start there begin from here.":
    "इस कथा के पत्रक, उनमें दर्ज हुई सब घटनाओं सहित, और इसके अध्याय सुरक्षित रखता है। वहाँ आरंभ की गई नई कथाएँ यहीं से शुरू होती हैं।",
  "Lowercase letters, digits and hyphens.": "छोटे अक्षर, अंक और हाइफ़न।",
  "You're watching. Join in whenever you like.": "आप देख रहे हैं। जब चाहें सम्मिलित हों।",
  "You're hushed for now: you can read, but not write.":
    "अभी आपको चुप कराया गया है: आप पढ़ सकते हैं, लिख नहीं सकते।",
  "What your character does": "आपका पात्र क्या करता है",
  "What your character says": "आपका पात्र क्या कहता है",
  "Steer the story directly": "कथा को सीधे दिशा दें",
  "The story should…": "कथा में आगे…",
  "I…": "मैं…",
  "You can write ahead while the story is writing.": "कथा लिखे जाते समय आप आगे लिख सकते हैं।",
  "Ready. Waiting for the others, or change your turn.":
    "तैयार। दूसरों की प्रतीक्षा है, या अपनी बारी बदलें।",
  "Others see this as you write. Ready sends it when everyone is ready.":
    "आप जैसे लिखते हैं, दूसरे इसे देखते हैं। सब तैयार हों तो ‘तैयार’ इसे भेज देता है।",
  "Not ready": "तैयार नहीं",

  // the board
  "Send {nick} away from the table?": "{nick} को पटल से विदा करें?",
  "A new name for {nick}:": "{nick} के लिए नया नाम:",
  Here: "यहाँ",
  "Not connected": "जुड़ा नहीं",
  "Let them speak": "बोलने दें",
  Hush: "चुप कराएँ",
  "Nobody has written yet. Everyone's turn goes in together.":
    "अभी किसी ने नहीं लिखा। सबकी बारी एक साथ जाती है।",
  "Everyone's ready.": "सब तैयार हैं।",
  "Waiting for {names}.": "{names} की प्रतीक्षा है।",
  "Turns appear here as people write them, so you can talk before anything is sent.":
    "लोग जैसे-जैसे लिखते हैं, बारियाँ यहाँ दिखती हैं, ताकि कुछ भेजे जाने से पहले आप बात कर सकें।",
  You: "आप",
  "{n} objection": "{n} आपत्ति",
  "{n} objections": "{n} आपत्तियाँ",
  "Objections still standing": "अब भी खड़ी आपत्तियाँ",
  "Object…": "आपत्ति…",
  "Why not, {nick}?": "{nick}, क्यों नहीं?",
  "Say something to the table": "पटल से कुछ कहें",
  "Join in to talk with the table.": "पटल से बात करने के लिए सम्मिलित हों।",
  "(answered)": "(उत्तर दिया गया)",
  "Take back": "वापस लें",

  // the front page and the worlds
  "Nothing has been played yet. Choose a world below and start a story; it saves itself as you play.":
    "अभी कुछ खेला नहीं गया। नीचे से कोई संसार चुनें और कथा आरंभ करें; खेलते-खेलते वह अपने आप संचित होती है।",
  "There are no worlds yet. Make one with “New world”, or put a world folder (one with a {file}) in your worlds folder and reload.":
    "अभी कोई संसार नहीं। “नवीन संसार” से एक बनाएँ, या अपने संसारों के फ़ोल्डर में कोई संसार-फ़ोल्डर ({file} वाला) रखकर पुनः लोड करें।",
  "Can't be read: {problem}": "पढ़ा नहीं जा सका: {problem}",
  "No tagline yet": "अभी कोई परिचय पंक्ति नहीं",
  "No tagline yet.": "अभी कोई परिचय पंक्ति नहीं।",
  "No stories yet": "अभी कोई कथा नहीं",
  "{n} saved story": "{n} संचित कथा",
  "{n} saved stories": "{n} संचित कथाएँ",
  "A story in {title} is open in the window.": "{title} की एक कथा खिड़की में खुली है।",
  "A story is open.": "एक कथा खुली है।",
  "Put it away (it stays saved) to start or continue a different one.":
    "कोई दूसरी आरंभ या जारी करने के लिए इसे समेट दें (यह संचित रहती है)।",
  "A story is open. Put it away first.": "एक कथा खुली है। पहले उसे समेट दें।",
  "Carry on with the latest story": "नवीनतम कथा जारी रखें",
  "Start a story": "कथा आरंभ करें",
  "This world could not be opened. The reason is shown above.":
    "यह संसार खोला नहीं जा सका। कारण ऊपर दिखाया गया है।",
  "Fix {file} in your worlds folder and reload, or put the world away.":
    "अपने संसारों के फ़ोल्डर में {file} सुधारें और पुनः लोड करें, या संसार को समेट दें।",
  "No stories in {title} yet. Start one above.": "{title} में अभी कोई कथा नहीं। ऊपर से एक आरंभ करें।",
  "Nothing is deleted: the folder is renamed, and renaming it back brings it back.":
    "कुछ मिटाया नहीं जाता: फ़ोल्डर का नाम बदल दिया जाता है, और नाम वापस बदलने पर वह लौट आता है।",
  "Stories already begun keep their own copy of the cards, so changes here show up in stories you start afterwards.":
    "पहले से आरंभ कथाएँ पत्रकों की अपनी प्रति रखती हैं, इसलिए यहाँ के परिवर्तन बाद में आरंभ की गई कथाओं में दिखते हैं।",
  "This world has no cards yet. Make a character, a place or a rule and the storyteller will use it.":
    "इस संसार में अभी कोई पत्रक नहीं। कोई पात्र, स्थान या नियम बनाएँ, कथावाचक उसका प्रयोग करेगा।",
  "Choose a card to read or change it, or make a new one.":
    "किसी पत्रक को पढ़ने या बदलने के लिए चुनें, या नया बनाएँ।",

  // making and changing a world
  "The storyteller always keeps this in mind. You can add places, people and rules as cards in the world's folder later.":
    "कथावाचक इसे सदा ध्यान में रखता है। आप बाद में संसार के फ़ोल्डर में स्थान, लोग और नियम पत्रकों के रूप में जोड़ सकते हैं।",
  "The story takes its own copy of the world's cards, so changing the world later never changes a story you've started.":
    "कथा संसार के पत्रकों की अपनी प्रति लेती है, इसलिए संसार को बाद में बदलने से आपकी आरंभ की हुई कथा कभी नहीं बदलती।",
  "The folder keeps its name, {name}. Stories already started keep the title they began with.":
    "फ़ोल्डर का नाम {name} ही रहता है। पहले से आरंभ कथाएँ उसी शीर्षक के साथ रहती हैं जिससे वे शुरू हुई थीं।",
  "Put “{title}” away?": "“{title}” को समेट दें?",
  "It disappears from your worlds, along with its {n} stories. Nothing is deleted: its folder is renamed to start with {prefix}, and renaming it back brings it back.":
    "यह आपके संसारों से हट जाता है, अपनी {n} कथाओं सहित। कुछ मिटाया नहीं जाता: इसके फ़ोल्डर का नाम {prefix} से शुरू होने वाला कर दिया जाता है, और नाम वापस बदलने पर यह लौट आता है।",
  "It disappears from your worlds, along with its {n} story. Nothing is deleted: its folder is renamed to start with {prefix}, and renaming it back brings it back.":
    "यह आपके संसारों से हट जाता है, अपनी {n} कथा सहित। कुछ मिटाया नहीं जाता: इसके फ़ोल्डर का नाम {prefix} से शुरू होने वाला कर दिया जाता है, और नाम वापस बदलने पर यह लौट आता है।",
  "A story in this world is open at the table. It closes for everyone, and stays saved.":
    "इस संसार की एक कथा पटल पर खुली है। वह सबके लिए बंद हो जाती है, और संचित रहती है।",

  // stories
  "This story's file can't be read.": "इस कथा की संचिका पढ़ी नहीं जा सकती।",
  "Just begun": "अभी आरंभ हुई है",
  "Needs repair before it can be continued": "जारी करने से पहले मरम्मत चाहिए",
  "{n} turn": "{n} बारी",
  "{n} turns": "{n} बारियाँ",
  "with {names}": "{names} के साथ",
  "just now": "अभी-अभी",
  "{n} min ago": "{n} मिनट पहले",
  "{n} h ago": "{n} घंटे पहले",
  yesterday: "कल",
  "{n} days ago": "{n} दिन पहले",

  // the manager
  "Stories can't start until they are fixed or removed. Nothing else is affected.":
    "जब तक ये सुधारे या हटाए न जाएँ, कथाएँ आरंभ नहीं हो सकतीं। बाकी कुछ प्रभावित नहीं होता।",
  "{n} cards can't be read": "{n} पत्रक पढ़े नहीं जा सके",
  "Parts you have filled in are kept.": "जो अंग आपने भरे हैं, वे बने रहते हैं।",
  "· what brings this card into a scene": "· जो इस पत्रक को दृश्य में लाता है",
  "Shown to the storyteller even when the whole card is not brought up.":
    "पूरा पत्रक न लाया जाए, तब भी यह कथावाचक को दिखता है।",
  "· use sparingly: it costs space in every turn": "· संयम से प्रयोग करें: यह हर बारी में स्थान लेता है",
  "· markdown": "· मार्कडाउन",
  "Link to other cards with relative paths, as in {example}":
    "सापेक्ष पथ से अन्य पत्रकों से जोड़ें, जैसे {example}",
  "Linked from {names}.": "{names} से जुड़ा है।",
  "No other card links to this one yet.": "कोई अन्य पत्रक अभी इससे नहीं जुड़ता।",
  "The fields are attributes of {card}; {keywords}, {summary} and any named part such as {appearance} come first; everything after them is markdown, left as written. Cards written the older way, with a {dashes} block, are read too.":
    "क्षेत्र {card} के गुण होते हैं; {keywords}, {summary} और {appearance} जैसा कोई भी नामित अंग पहले आते हैं; उनके बाद का सब कुछ मार्कडाउन है, जैसा लिखा गया वैसा ही रखा जाता है। पुराने ढंग से, {dashes} खंड के साथ, लिखे पत्रक भी पढ़े जाते हैं।",
  "Remove {name}?": "{name} हटाएँ?",
  "This deletes the card's file, {path}, from the world's folder. Stories already begun keep their own copy. If the world is in git, the file can be brought back.":
    "यह संसार के फ़ोल्डर से पत्रक की संचिका, {path}, मिटा देता है। पहले से आरंभ कथाएँ अपनी प्रति रखती हैं। यदि संसार git में है, तो संचिका लौटाई जा सकती है।",

  // light and dark
  "Dark mode": "गहरा रूप",
  "Light mode": "हल्का रूप",

  // chapters and drafts
  Drafts: "मसौदे",
  Chapter: "अध्याय",
  Draft: "मसौदा",
  "Read all the chapters": "सभी अध्याय पढ़ें",
  "{n} KB": "{n} केबी",
  "No chapters in this world yet.": "इस संसार में अभी कोई अध्याय नहीं।",
  "No drafts in this world yet.": "इस संसार में अभी कोई मसौदा नहीं।",

  // the reader
  Read: "पढ़ें",
  "Read it as a book": "इसे पुस्तक की तरह पढ़ें",
  Close: "बंद करें",
  Contents: "विषय-सूची",
  "Title page": "आवरण-पृष्ठ",
  Mood: "वातावरण",
  Dusk: "गोधूलि",
  Embers: "अंगारे",
  Forest: "वन",
  Rain: "वर्षा",
  Moonlight: "चाँदनी",
  Ink: "स्याही",
  "Sound on": "ध्वनि चालू",
  "Sound off": "ध्वनि बंद",
  "The end": "समाप्त",
  "Page {n} of {total}": "पृष्ठ {n} / {total}",
  "Turn the page with the arrow keys, or swipe": "पृष्ठ पलटने के लिए तीर-कुंजियाँ दबाएँ, या उँगली फिराएँ",

  // visual novels
  "Visual novel": "दृश्य-उपन्यास",
  Slides: "स्लाइडें",
  Mode: "मोड",
  Protagonist: "मुख्य पात्र",
  Routes: "मार्ग",
  Preview: "पूर्वावलोकन",
  "Choose a writing to read or inspect": "पढ़ने या जाँचने के लिए कोई रचना चुनें",
  "Loading preview…": "पूर्वावलोकन लोड हो रहा है…",
  "Adapt to VN": "दृश्य-उपन्यास बनाएँ",
  "Adapt this prose into an interactive visual novel":
    "इस गद्य को एक संवादात्मक दृश्य-उपन्यास में रूपांतरित करें",
  "Recompile VN": "VN फिर संकलित करें",
  "Compile visual novel slides": "दृश्य-उपन्यास की स्लाइडें संकलित करें",
  "VN: {count} slides": "दृश्य-उपन्यास: {count} स्लाइडें",
  "Visual novel adaptation with slides ready": "दृश्य-उपन्यास रूपांतरण स्लाइडों सहित तैयार है",
  "Play VN": "VN खेलें",
  "Play this visual novel in the browser": "ब्राउज़र में यह दृश्य-उपन्यास खेलें",
  Auto: "स्वचालित",
  Skip: "छोड़ें",
  Log: "इतिहास",
  Variables: "चर",
  canon: "प्रामाणिक",
  "Chapter Complete": "अध्याय समाप्त",
  "You have reached the end of this visual novel adaptation beat.":
    "आप इस दृश्य-उपन्यास रूपांतरण के अंत तक पहुँच गए हैं।",
  Restart: "पुनः आरंभ",
  "Dialogue History": "संवाद इतिहास",
  "No dialogue history yet.": "अभी कोई संवाद इतिहास नहीं है।",
  "Chose:": "चुना:",
  "No variables tracked in this adaptation.": "इस रूपांतरण में कोई चर ट्रैक नहीं किया जा रहा।",
  "No slides available in this visual novel.": "इस दृश्य-उपन्यास में कोई स्लाइड उपलब्ध नहीं है।",

  // asset studio
  "Asset Studio": "संसाधन-कार्यशाला",
  "All assets": "सभी संसाधन",
  "Shared pool": "साझा भंडार",
  "Search assets": "संसाधन खोजें",
  All: "सभी",
  Shared: "साझा",
  Sprites: "पात्र-चित्र",
  "Event CGs": "प्रसंग-चित्र",
  Backgrounds: "पृष्ठभूमियाँ",
  Clothes: "वस्त्र",
  Adornments: "अलंकरण",
  Objects: "वस्तुएँ",
  "Locked to": "इनसे बँधा:",
  Base: "मूल",
  "Not linked yet": "अभी जुड़ा नहीं",
  "Loading assets…": "संसाधन लोड हो रहे हैं…",
  "Nothing matches.": "कुछ मेल नहीं खाता।",
  "Batch actions": "सामूहिक कार्य",
  "Add an asset": "संसाधन जोड़ें",
  "Remove asset": "संसाधन हटाएँ",
  "Pick one visual novel above to add to it.": "जोड़ने के लिए ऊपर से एक दृश्य-कथा चुनें।",
  Kind: "प्रकार",
  Character: "पात्र",
  "Character (optional)": "पात्र (वैकल्पिक)",
  Name: "नाम",
  "Expression, e.g. neutral": "भाव, जैसे neutral",
  "Name, e.g. harbour_dusk": "नाम, जैसे harbour_dusk",
  "Added {name}. Write its prompt and generate it.": "{name} जोड़ा गया। इसका प्रॉम्प्ट लिखें और बनाएँ।",
  "Removed {name}.": "{name} हटाया गया।",
  "Remove {name} from the plan and delete its image? Its earlier runs stay in the dataset.":
    "{name} को योजना से हटाएँ और उसकी छवि मिटाएँ? उसके पुराने रन डेटासेट में रहेंगे।",
  "Archive all": "सभी संग्रहित करें",
  "Delete all": "सभी हटाएँ",
  Archive: "संग्रहित करें",
  Delete: "हटाएँ",
  "Delete this render of {name}? Its image file is removed and cannot be brought back.":
    "{name} का यह चित्र हटाएँ? इसकी चित्र-फ़ाइल हट जाएगी और वापस नहीं आएगी।",
  "Select an asset from the list to edit its prompt and generate it.":
    "सूची से कोई संसाधन चुनें, उसका प्रॉम्प्ट बदलें और उसे बनाएँ।",
  "Not generated yet": "अभी बना नहीं है",
  "No render running. Adjust the tags below, then Generate.":
    "कोई निर्माण नहीं चल रहा। नीचे टैग समायोजित करें, फिर बनाएँ।",
  "Tags and feedback": "टैग और प्रतिक्रिया",
  "Pick tags to steer. Better adds attention, Worse lowers it.":
    "दिशा देने के लिए टैग चुनें। बेहतर ध्यान बढ़ाता है, ख़राब घटाता है।",
  Better: "बेहतर",
  Keep: "जस का तस",
  Worse: "ख़राब",
  Add: "जोड़ें",
  Prompts: "प्रॉम्प्ट",
  Positive: "सकारात्मक",
  Negative: "नकारात्मक",
  Sampler: "सैम्पलर",
  Steps: "चरण",
  steps: "चरण",
  Guidance: "मार्गदर्शन",
  guidance: "मार्गदर्शन",
  Scheduler: "शेड्यूलर",
  Seed: "बीज",
  History: "इतिहास",
  "No archived passes yet. Earlier renders are kept here automatically.":
    "अभी कोई संग्रहित प्रयास नहीं। पिछले निर्माण यहाँ अपने-आप सहेजे जाते हैं।",
  Generate: "बनाएँ",
  "Generating…": "बन रहा है…",
  Working: "चल रहा है",
  Done: "पूर्ण",
  Failed: "विफल",
  Cancelled: "रद्द",
  Cancel: "रद्द करें",
  "Workflow steps": "कार्यप्रवाह के चरण",
  Workflow: "कार्यप्रवाह",
  "All steps": "सभी चरण",
  "Prepare prompt and archive previous": "प्रॉम्प्ट तैयार करें, पिछला संग्रहित करें",
  "Wait in ComfyUI queue": "ComfyUI की कतार में प्रतीक्षा",
  Render: "निर्माण",
  "Download and save": "उतारें और सहेजें",
  "Archived to dataset history.": "डेटासेट इतिहास में संग्रहित हुआ।",
  "Deleted {name}; back to Pending.": "{name} हटाया गया; फिर से लंबित।",
  "Archived {count} assets.": "{count} संसाधन संग्रहित हुए।",
  "Deleted {count} rendered files.": "{count} बनी हुई फ़ाइलें हटाई गईं।",
  "The table restarted while this was running. Start it again.":
    "यह चल रहा था तभी पटल पुनः आरंभ हुआ। इसे फिर शुरू करें।",
  "No visual novels found. Adapt a chapter first.":
    "कोई दृश्य-उपन्यास नहीं मिला। पहले कोई अध्याय रूपांतरित करें।",

  // asset studio
  Dataset: "डेटासेट",
  "Dataset gallery": "डेटासेट दीर्घा",
  Asset: "संसाधन",
  Find: "खोजें",
  "Every asset": "हर संसाधन",
  "archived renders": "संग्रहित निर्माण",
  "Open in studio": "कार्यशाला में खोलें",
  "Open full gallery": "पूरी दीर्घा खोलें",
  "Generation queue": "निर्माण कतार",
  Dismiss: "हटाएँ",
  "Clear finished": "पूर्ण हटाएँ",
  "Drag to move. Alt + arrows moves it too.": "खिसकाने के लिए खींचें। Alt + तीर कुंजियाँ भी खिसकाती हैं।",

  // agent access (a token for the adaptation agent)
  "Agent access": "एजेंट की पहुँच",
  "Tokens that let an agent import or adapt this world":
    "टोकन जिनसे कोई एजेंट इस संसार को आयात या रूपांतरित कर सकता है",
  "Agent access needs the database and an author who is signed in.":
    "एजेंट की पहुँच के लिए डेटाबेस और लॉग-इन किया हुआ एक लेखक चाहिए।",
  "A token lets an agent import into this world and adapt it, at {root}, and nothing else. It is shown once. Revoke it to stop it.":
    "टोकन से एजेंट {root} पर इस संसार में आयात और इसका रूपांतरण कर सकता है, और कुछ नहीं। यह एक ही बार दिखता है। रोकने के लिए इसे रद्द करें।",
  "Import a world": "संसार आयात करें",
  "Name the world. It is made now, empty, with a token for each agent that will fill it from your files.":
    "संसार का नाम रखें। वह अभी, खाली, बन जाता है, और आपकी फ़ाइलों से उसे भरने वाले हर एजेंट के लिए एक टोकन मिलता है।",
  "Kinds of card the settings worker may write, separated by commas":
    "परिवेश वाला कार्यकर्ता किन प्रकार के कार्ड लिख सकता है, अल्पविराम से अलग",
  "The tokens last": "टोकन कितने दिन चलें",
  "Make the world and its tokens": "संसार और उसके टोकन बनाएँ",
  "Ready to import into {title}": "{title} में आयात के लिए तैयार",
  "Copy the tokens and the prompt now: the tokens will not be shown again. Set the tokens as environment variables in the terminal where the agent runs.":
    "टोकन और निर्देश अभी नकल कर लें: टोकन दोबारा नहीं दिखेंगे। टोकनों को उस टर्मिनल में पर्यावरण-चर के रूप में रखें जहाँ एजेंट चलता है।",
  Tokens: "टोकन",
  "What you expect of the import (edit it)": "आयात से आपकी अपेक्षा (इसे बदल सकते हैं)",
  "Prompt for the agent": "एजेंट के लिए निर्देश",
  "In the prompt, fill in the three places in angle brackets: the source folder, the folder the agent works in, and the Nirmata repository.":
    "निर्देश में कोण-कोष्ठक वाली तीन जगहें भरें: स्रोत फ़ोल्डर, एजेंट का कार्य-फ़ोल्डर और निर्माता का रिपॉज़िटरी।",
  "Works on": "किस पर काम करे",
  Everything: "सब कुछ",
  "Characters only": "केवल पात्र",
  "Accessories only": "केवल साज-सामान",
  "Settings only": "केवल परिवेश",
  "Other kinds": "अन्य प्रकार",
  "Kinds of card, separated by commas": "कार्ड के प्रकार, अल्पविराम से अलग",
  "kinds: {kinds}": "प्रकार: {kinds}",
  "any kind": "कोई भी प्रकार",
  "Your new token. Copy it now: it will not be shown again.":
    "आपका नया टोकन। अभी नकल कर लें: यह दोबारा नहीं दिखेगा।",
  Copy: "नकल करें",
  Copied: "नकल हो गया",
  "What it is for": "यह किसलिए है",
  Lasts: "कितने दिन चले",
  "{n} days": "{n} दिन",
  "Make a token": "टोकन बनाएँ",
  "No tokens yet.": "अभी कोई टोकन नहीं।",
  Active: "चालू",
  Revoked: "रद्द",
  Expired: "समाप्त",
  "until {date}": "{date} तक",
  "last used {date}": "अंतिम उपयोग {date}",
  "never used": "कभी उपयोग नहीं हुआ",
  Revoke: "रद्द करें",
};

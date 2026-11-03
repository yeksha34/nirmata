// Hindi for what the server says to people: its errors, refusals, notices and the in-the-story
// lines that announce a hushed or renamed player. The server sends English; the screen matches the
// text against these (a `{mark}` stands for the part that changes: a name, a file, a count) and
// shows the Hindi with the English on hover. A message with no match shows in English alone.
export const HI_SERVER: Record<string, string> = {
  // the server and the table
  "Something went wrong on the server. Try again.": "सर्वर पर कुछ गड़बड़ हो गई। फिर प्रयास करें।",
  "Something went wrong with the story.": "कथा में कुछ गड़बड़ हो गई।",
  "Something went wrong with the story. The host can try again.":
    "कथा में कुछ गड़बड़ हो गई। यजमान फिर प्रयास कर सकते हैं।",
  "That request is not right: {why}": "वह अनुरोध ठीक नहीं है: {why}",
  "Pick a nickname to join with.": "जुड़ने के लिए कोई उपनाम चुनें।",
  "There is nothing at that address.": "उस पते पर कुछ नहीं है।",
  "A world needs a title.": "संसार को एक शीर्षक चाहिए।",
  "A card needs a name.": "पत्रक को एक नाम चाहिए।",
  "Say which card to remove.": "बताएँ कि कौन-सा पत्रक हटाना है।",
  "Say which chapter or draft to read.": "बताएँ कि कौन-सा अध्याय या मसौदा पढ़ना है।",
  "A world's name uses lowercase letters, digits and hyphens.":
    "संसार के नाम में छोटे अक्षर, अंक और हाइफ़न होते हैं।",
  "A world's name uses lowercase letters, digits and hyphens, 2 to 40 characters.":
    "संसार के नाम में छोटे अक्षर, अंक और हाइफ़न होते हैं, 2 से 40 अक्षर।",
  "Only the host can see the settings.": "केवल यजमान सेटिंग देख सकते हैं।",
  "That is too much to send at once.": "इतना सब एक साथ नहीं भेजा जा सकता।",
  "Choose a world first.": "पहले कोई संसार चुनें।",
  "Asset not found.": "संसाधन नहीं मिला।",
  "That host key is not right.": "वह यजमान-कुंजी सही नहीं है।",
  "The table is full. Try again later.": "पटल भरा है। बाद में फिर प्रयास करें।",
  "Join the table first.": "पहले पटल पर आएँ।",
  "You left the table.": "आपने पटल छोड़ दिया।",
  "You are no longer at this table.": "आप अब इस पटल पर नहीं हैं।",
  "You were sent away from the table.": "आपको पटल से विदा कर दिया गया।",
  "Opt in to play before you do that.": "यह करने से पहले खेलने के लिए सम्मिलित हों।",
  "Your voice is hushed for now: you can read, but not do that.":
    "अभी आपकी वाणी रोकी गई है: आप पढ़ सकते हैं, पर यह नहीं कर सकते।",
  "There is nothing on the board to close, or the story is busy.":
    "बंद करने को पटल पर कुछ नहीं है, या कथा व्यस्त है।",
  "There is no such moment in this story.": "इस कथा में ऐसा कोई क्षण नहीं है।",
  "There is no story yet. The host can start one.": "अभी कोई कथा नहीं है। यजमान एक आरंभ कर सकते हैं।",
  "The story is busy writing. Wait for it to finish.":
    "कथा लिखने में व्यस्त है। उसके पूरा होने की प्रतीक्षा करें।",

  // worlds, stories and cards on disk
  "That path is outside the world's folder.": "वह पथ संसार के फ़ोल्डर के बाहर है।",
  "This world has no world.json.": "इस संसार में world.json नहीं है।",
  'A card\'s path must be a .md file inside {dirs} (got "{path}").':
    'पत्रक का पथ {dirs} के भीतर की .md संचिका होना चाहिए (मिला: "{path}")।',
  'There is already a world called "{name}". Pick another name.':
    '"{name}" नाम का संसार पहले से है। कोई और नाम चुनें।',
  'There is no story "{id}".': '"{id}" नाम की कोई कथा नहीं है।',
  'There is no world "{name}".': '"{name}" नाम का कोई संसार नहीं है।',
  "There is no card at {path}.": "{path} पर कोई पत्रक नहीं है।",
  "There is no chapter or draft at {path}.": "{path} पर कोई अध्याय या मसौदा नहीं है।",
  'There is no card "{id}" in this world.': 'इस संसार में "{id}" नाम का कोई पत्रक नहीं है।',
  'There is no card "{id}" to remove.': 'हटाने के लिए "{id}" नाम का कोई पत्रक नहीं है।',
  "That card cannot be read, so it cannot be edited as a form. Edit it as text.":
    "वह पत्रक पढ़ा नहीं जा सकता, इसलिए उसे फ़ॉर्म से संपादित नहीं किया जा सकता। उसे पाठ के रूप में संपादित करें।",
  "That card is not valid: {why}": "वह पत्रक मान्य नहीं है: {why}",
  'Couldn\'t put "{name}" away ({why}). Close anything using its folder and try again.':
    '"{name}" को समेटा नहीं जा सका ({why})। इसके फ़ोल्डर का उपयोग करने वाली हर चीज़ बंद करें और फिर प्रयास करें।',
  'The saved story "{id}" is damaged: {why}': 'संचित कथा "{id}" क्षतिग्रस्त है: {why}',
  "The host has not allowed players to read the source cards.":
    "यजमान ने खिलाड़ियों को मूल पत्रक पढ़ने की अनुमति नहीं दी है।",
  "This story has no copy of its cards to save a world from.":
    "इस कथा के पास अपने पत्रकों की प्रति नहीं है जिससे संसार संचित किया जा सके।",

  // permissions
  "Only the host can edit the source cards.": "केवल यजमान मूल पत्रक संपादित कर सकते हैं।",
  "Only the host can start a story.": "केवल यजमान कथा आरंभ कर सकते हैं।",
  "Only the host may do that.": "यह केवल यजमान कर सकते हैं।",
  "That request came from another site.": "यह अनुरोध किसी अन्य जालस्थल से आया है।",
  "Wrong email or password.": "ईमेल या गुप्तशब्द ग़लत है।",
  "An invitation is required to sign up.": "पंजीकरण के लिए आमंत्रण आवश्यक है।",
  "Sign-in is not available right now.": "प्रवेश अभी उपलब्ध नहीं है।",
  "That did not work. Check the details and try again.": "यह सफल नहीं हुआ। विवरण जाँचकर पुनः प्रयास करें।",
  "Sign in first.": "पहले प्रवेश करें।",
  "This table already has a host.": "इस पटल का पहले से एक यजमान है।",
  "The database cannot be reached right now.": "आँकड़ा-भंडार अभी पहुँच में नहीं है।",
  "That is the asset's current image, so its file is kept. Make a new image first, then delete this one.":
    "यही इस सामग्री का वर्तमान चित्र है, इसलिए इसकी फ़ाइल रखी गई है। पहले नया चित्र बनाएँ, फिर इसे हटाएँ।",
  "There is no such run.": "ऐसा कोई प्रयास नहीं है।",
  "The prompts file cannot be read, so nothing was saved.":
    "संकेत-फ़ाइल पढ़ी नहीं जा सकती, इसलिए कुछ सहेजा नहीं गया।",
  "A reference sprite does not exist yet. Generate it first, or remove it from the references.":
    "एक संदर्भ-आकृति अभी बनी नहीं है। पहले उसे बनाएँ, या संदर्भों से हटा दें।",
  "This workflow has no place for a reference image. Use a workflow with a Reference Image node.":
    "इस कार्यप्रवाह में संदर्भ-चित्र के लिए स्थान नहीं है। संदर्भ-चित्र वाली कड़ी के साथ कार्यप्रवाह चुनें।",
  "Finish setting up your account first.": "पहले अपना खाता पूरा बनाएँ।",
  "Your profile cannot be read right now.": "आपका परिचय अभी पढ़ा नहीं जा सकता।",
  "An account with that address already exists. Sign in instead.":
    "उस पते का खाता पहले से है। प्रवेश करें।",
  "The database is not set up on this server.": "इस सेवक पर आँकड़ा-भंडार स्थापित नहीं है।",
  "Confirm that you are an adult first.": "पहले पुष्टि करें कि आप वयस्क हैं।",
  "That invitation is not valid.": "वह आमंत्रण मान्य नहीं है।",
  "You may not accept that invitation.": "आप वह आमंत्रण स्वीकार नहीं कर सकते।",
  "There is no such file.": "ऐसी कोई संचिका नहीं है।",
  "The file was deleted; only its record is kept.": "संचिका मिटा दी गई है; केवल उसका अभिलेख रखा गया है।",
  "That file's store is not set up on this server.": "उस संचिका का भंडार इस सेवक पर स्थापित नहीं है।",
  "The file is not in its store.": "संचिका अपने भंडार में नहीं है।",
  "You can't take part in this story.": "आप इस कथा में भाग नहीं ले सकते।",
  "You can't undo in this story.": "आप इस कथा में पूर्ववत नहीं कर सकते।",
  "You can't edit turns in this story.": "आप इस कथा में बारियाँ संपादित नहीं कर सकते।",
  "You can't pin facts in this story.": "आप इस कथा में तथ्य टाँक नहीं सकते।",
  "Only the host can jump to another branch of the story.":
    "केवल यजमान कथा की किसी दूसरी शाखा पर जा सकते हैं।",
  "Only the host can update plot points.": "केवल यजमान कथानक-बिंदु अद्यतन कर सकते हैं।",
  "Only the host can add plot points.": "केवल यजमान कथानक-बिंदु जोड़ सकते हैं।",
  "Only the host can take back plot points.": "केवल यजमान कथानक-बिंदु वापस ले सकते हैं।",
  "Only the host can start a new chapter.": "केवल यजमान नया अध्याय आरंभ कर सकते हैं।",
  "Only the host can change settings.": "केवल यजमान सेटिंग बदल सकते हैं।",
  "Only the host can wield that power.": "केवल यजमान उस शक्ति का प्रयोग कर सकते हैं।",

  // the board
  'The nickname "{nick}" is already taken at this table.':
    'उपनाम "{nick}" इस पटल पर पहले से लिया जा चुका है।',
  "The host cannot leave the table.": "यजमान पटल नहीं छोड़ सकते।",
  "The host keeps their seat at the table.": "यजमान पटल पर अपना आसन बनाए रखते हैं।",
  "Keep a turn under {n} characters.": "बारी {n} अक्षरों से कम रखें।",
  "Keep a remark under {n} characters.": "टिप्पणी {n} अक्षरों से कम रखें।",
  "Write your turn before marking it ready.": "तैयार चिह्नित करने से पहले अपनी बारी लिखें।",
  "Object to someone else's turn.": "किसी और की बारी पर आपत्ति करें।",
  "You can only take back your own remarks.": "आप केवल अपनी टिप्पणियाँ वापस ले सकते हैं।",
  "Pick a nickname of 1 to 24 letters, digits or {chars} (no spaces).":
    "1 से 24 अक्षरों, अंकों या {chars} का उपनाम चुनें (रिक्त स्थान नहीं)।",
  "Opt in to play before writing a turn.": "बारी लिखने से पहले खेलने के लिए सम्मिलित हों।",
  "Your voice is hushed for now: you can read, but not write.":
    "अभी आपकी वाणी रोकी गई है: आप पढ़ सकते हैं, लिख नहीं सकते।",
  "That power cannot be used on the host.": "वह शक्ति यजमान पर प्रयोग नहीं की जा सकती।",
  "Write something first.": "पहले कुछ लिखें।",

  // the storyteller
  "This story has already started.": "यह कथा पहले ही आरंभ हो चुकी है।",
  "Type something to do or say first.": "पहले कुछ करने या कहने के लिए लिखें।",
  "The host has not started this story yet.": "यजमान ने अभी यह कथा आरंभ नहीं की।",
  "There is no reply to retry yet.": "दोबारा आज़माने के लिए अभी कोई उत्तर नहीं है।",
  "The reply to retry does not follow a player action.":
    "दोबारा आज़माया जाने वाला उत्तर किसी खिलाड़ी की क्रिया के बाद का नहीं है।",
  "There is no turn to answer.": "उत्तर देने के लिए कोई बारी नहीं है।",
  "There is nothing to continue yet.": "आगे बढ़ाने को अभी कुछ नहीं है।",
  "Write what happened first.": "पहले लिखें कि क्या हुआ।",
  "Nothing has happened yet to attach a plot point to.": "कथानक-बिंदु जोड़ने के लिए अभी कुछ घटित नहीं हुआ।",
  "There is nothing in the story yet to attach a plot point to.":
    "कथा में अभी कथानक-बिंदु जोड़ने को कुछ नहीं है।",
  "That plot point is not in force on this branch.": "वह कथानक-बिंदु इस शाखा में लागू नहीं है।",
  "Nothing has happened yet to end a chapter.": "अध्याय समाप्त करने के लिए अभी कुछ घटित नहीं हुआ।",
  "This story has no cards to play with.": "इस कथा के पास खेलने के लिए कोई पत्रक नहीं है।",
  "There are no source cards to start this story from.":
    "इस कथा को आरंभ करने के लिए कोई मूल पत्रक नहीं हैं।",
  "A turn is already in progress.": "एक बारी पहले से चल रही है।",
  "Could not save the story: {why}": "कथा संचित नहीं की जा सकी: {why}",
  "The model sent back an empty reply. Try again, or check the model and context size in Settings.":
    "मॉडल ने खाली उत्तर लौटाया। फिर प्रयास करें, या सेटिंग में मॉडल और संदर्भ-आकार जाँचें।",
  "The reply was cut off at the length limit. Use Continue to finish it, or raise the maximum reply length.":
    "उत्तर लंबाई की सीमा पर कट गया। उसे पूरा करने के लिए ‘आगे बढ़ें’ का प्रयोग करें, या अधिकतम उत्तर-लंबाई बढ़ाएँ।",
  "The rule check could not run, so this reply was not checked ({why}).":
    "नियम-जाँच चल नहीं सकी, इसलिए इस उत्तर की जाँच नहीं हुई ({why})।",
  "There is nothing new to read for plot points yet.": "कथानक-बिंदुओं के लिए अभी पढ़ने को कुछ नया नहीं है।",
  "No card is mentioned in the recent story, so there is nothing to attach plot points to.":
    "हाल की कथा में किसी पत्रक का उल्लेख नहीं है, इसलिए कथानक-बिंदु जोड़ने को कुछ नहीं है।",
  "Plot points could not be updated this time ({why}). Play continues and it will be tried again.":
    "इस बार कथानक-बिंदु अद्यतन नहीं हो सके ({why})। खेल जारी है और फिर प्रयास किया जाएगा।",

  // the model
  "The prompt is longer than this model can read. Lower the context size in Settings, or shorten your rules.":
    "संकेत इस मॉडल के पढ़ने से लंबा है। सेटिंग में संदर्भ-आकार घटाएँ, या अपने नियम छोटे करें।",
  "{label} rejected the API key. Check or re-enter it in Settings.":
    "{label} ने API कुंजी अस्वीकार कर दी। सेटिंग में उसे जाँचें या फिर से दर्ज करें।",
  "{label} refused the request (permission denied). Check that your key has access to this model.":
    "{label} ने अनुरोध अस्वीकार कर दिया (अनुमति नहीं)। जाँचें कि आपकी कुंजी को इस मॉडल की पहुँच है।",
  '{label} does not have a model called "{model}", or the address is wrong. Pick another model in Settings.':
    '{label} के पास "{model}" नाम का मॉडल नहीं है, या पता गलत है। सेटिंग में कोई और मॉडल चुनें।',
  "{label} did not recognise that address ({url}). Check the address in Settings.":
    "{label} उस पते ({url}) को पहचान नहीं सका। सेटिंग में पता जाँचें।",
  "{label} says you are sending requests too fast or are out of quota. Wait a moment and try again.":
    "{label} कहता है कि आप अनुरोध बहुत तेज़ भेज रहे हैं या कोटा समाप्त है। थोड़ी प्रतीक्षा करें और फिर प्रयास करें।",
  "{label} rejected the request: {why}": "{label} ने अनुरोध अस्वीकार कर दिया: {why}",
  "{label} rejected the request.": "{label} ने अनुरोध अस्वीकार कर दिया।",
  "{label} had a problem on its side (error {n}). Try again; if it keeps happening, check its logs.":
    "{label} की ओर से समस्या हुई (त्रुटि {n})। फिर प्रयास करें; बार-बार हो तो उसके लॉग जाँचें।",
  "{label} answered with an unexpected status ({n}).":
    "{label} ने अप्रत्याशित स्थिति ({n}) के साथ उत्तर दिया।",
  "Can't reach {label} at {url}. If you use KoboldCpp, Ollama or LM Studio, make sure it is running and the port matches.":
    "{url} पर {label} तक नहीं पहुँच पा रहे। यदि आप KoboldCpp, Ollama या LM Studio प्रयोग करते हैं, तो सुनिश्चित करें कि वह चल रहा है और पोर्ट मेल खाता है।",
  "Can't reach {label} at {url}. Check your internet connection and the address in Settings.":
    "{url} पर {label} तक नहीं पहुँच पा रहे। अपना इंटरनेट कनेक्शन और सेटिंग में दिया पता जाँचें।",
  "{label} reported an error: {why}": "{label} ने त्रुटि बताई: {why}",
  "Stopped.": "रोक दिया गया।",

  // a card or a world that cannot be read (from the card reader and its schema)
  "not a card: the file should start with <card …> (or an older --- block)":
    "यह पत्रक नहीं है: संचिका <card …> से (या पुराने --- खंड से) शुरू होनी चाहिए",
  "frontmatter is not valid YAML: {why}": "फ्रंटमैटर मान्य YAML नहीं है: {why}",
  'could not read the card\'s opening tag near "{near}" (write each field as name="value")':
    'पत्रक का आरंभिक टैग "{near}" के पास पढ़ा नहीं जा सका (हर क्षेत्र को name="value" के रूप में लिखें)',
  'the field "{key}" is written twice in the opening tag': 'क्षेत्र "{key}" आरंभिक टैग में दो बार लिखा है',
  "the card has no closing </card> at the end of the file":
    "संचिका के अंत में पत्रक का समापन </card> नहीं है",
  "<{tag}>: {why}": "<{tag}>: {why}",
  "<{tag}> is never closed (write </{tag}>)": "<{tag}> कभी बंद नहीं किया गया (</{tag}> लिखें)",
  '<data> needs a key, as in <data key="mood">…</data>':
    '<data> को एक कुंजी चाहिए, जैसे <data key="mood">…</data>',
  '<data key="{key}"> does not hold valid JSON': '<data key="{key}"> में मान्य JSON नहीं है',
  "the part <{tag}> is written twice": "अंग <{tag}> दो बार लिखा है",
  "world.json is not valid JSON: {why}": "world.json मान्य JSON नहीं है: {why}",
  "world.json: {why}": "world.json: {why}",
  'duplicate id "{id}" in {path} (first used in {first})':
    'पहचान "{id}" दोहराई गई है, {path} में (पहली बार {first} में प्रयुक्त)',
  "{path}.md: {why}": "{path}.md: {why}",
  "{field}: Required": "{field}: आवश्यक है",
  "{field}: Invalid input": "{field}: अमान्य इनपुट",
  "{field}: Invalid enum value. Expected {options}, received {got}":
    "{field}: अमान्य मान। अपेक्षित {options}, मिला {got}",
  "{field}: String must contain at least {n} character(s)": "{field}: कम से कम {n} अक्षर होने चाहिए",
  "{field}: Expected {expected}, received {got}": "{field}: अपेक्षित {expected}, मिला {got}",
  '{field}: id must look like "kind.slug" (lowercase letters, digits, hyphens)':
    '{field}: पहचान "kind.slug" जैसी होनी चाहिए (छोटे अक्षर, अंक, हाइफ़न)',
  "{field}: a field name is lowercase letters, digits and hyphens":
    "{field}: अंग का नाम छोटे अक्षर, अंक और हाइफ़न से बनता है",
  "Raise the context size, lower the reply reserve, or shorten the rules marked must.":
    "संदर्भ-आकार बढ़ाएँ, उत्तर के लिए रखा स्थान घटाएँ, या ‘अनिवार्य’ चिह्नित नियम छोटे करें।",

  // more announcements, the board, the model's answers, files and a damaged story
  "{host} speaks a word of leaving; the door swings wide and an unseen wind sweeps {target} through it.":
    "{host} विदा का एक शब्द बोलते हैं; द्वार खुल जाता है और एक अदृश्य हवा {target} को उससे बाहर बहा ले जाती है।",
  "{host} snaps out a roll of heavy tape and mummifies {target}, who is carried out like a parcel.":
    "{host} मोटी टेप का एक गट्ठर खींच निकालते हैं और {target} को ममी बना देते हैं, जिन्हें पार्सल की तरह उठाकर बाहर ले जाया जाता है।",
  "{host}'s halberd hooks {target} by the collar, and the guards haul them out of the room.":
    "{host} का हलबर्ड {target} को कॉलर से अटका लेता है, और पहरेदार उन्हें कमरे से घसीट ले जाते हैं।",
  "{host} pulls a lever; the chair under {target} shoots up the chimney.":
    "{host} एक लीवर खींचते हैं; {target} के नीचे की कुर्सी चिमनी से ऊपर उछल जाती है।",
  "{host} breathes out a hush-spell; {target}'s voice folds up like paper and goes quiet.":
    "{host} एक मौन-मंत्र फूँकते हैं; {target} की वाणी कागज़ की तरह तह होकर चुप हो जाती है।",
  "{host} presses a neat length of tape across {target}'s lips.":
    "{host} {target} के होंठों पर सलीके से टेप की एक पट्टी दबा देते हैं।",
  "{host}'s gauntlet clamps gently over {target}'s mouth.":
    "{host} का दस्ताना {target} के मुँह पर धीरे से कस जाता है।",
  "{host} lays the flat of a sword across {target}'s lips, and {target} knows to say no more.":
    "{host} तलवार की चपटी धार {target} के होंठों पर रख देते हैं, और {target} समझ जाते हैं कि अब और नहीं कहना।",
  "{host} snaps a finger; the stillness on {target}'s tongue melts away.":
    "{host} चुटकी बजाते हैं; {target} की जीभ की निस्तब्धता पिघल जाती है।",
  "{host} lifts the tape from {target}'s lips, and they may speak again.":
    "{host} {target} के होंठों से टेप उठा लेते हैं, और वे फिर बोल सकते हैं।",
  "{host} lifts the gauntlet from {target}'s mouth.": "{host} {target} के मुँह से दस्ताना उठा लेते हैं।",
  "{host} chalks a rune in the air, and {target} answers to {newName} from now on.":
    "{host} हवा में एक रून खींचते हैं, और {target} अब से {newName} कहलाते हैं।",
  "{host} slaps a fresh strip of tape across {target}'s badge and scrawls {newName} on it.":
    "{host} {target} के बिल्ले पर टेप की नई पट्टी चिपकाकर उस पर {newName} लिख देते हैं।",
  "{host} chisels a new name into {target}'s shield: {newName}.":
    "{host} {target} की ढाल पर नया नाम उकेरते हैं: {newName}।",
  "{host}'s dagger scratches {newName} over {target}'s old name on the table.":
    "{host} का खंजर पटल पर {target} के पुराने नाम के ऊपर {newName} खरोंच देता है।",
  "{nick} has not written anything yet to object to.": "{nick} ने अभी आपत्ति करने को कुछ नहीं लिखा।",
  '"{nick}" has not joined this table.': '"{nick}" इस पटल पर नहीं जुड़ा।',
  "{who} did not return JSON.": "{who} ने JSON नहीं लौटाया।",
  "{who} returned JSON that could not be read.": "{who} ने ऐसा JSON लौटाया जो पढ़ा नहीं जा सका।",
  "Something went wrong: {why}": "कुछ गड़बड़ हो गई: {why}",
  "{label} sent an empty reply.": "{label} ने खाली उत्तर भेजा।",
  "Connected to {label}. {n} models available.": "{label} से जुड़ गए। {n} मॉडल उपलब्ध हैं।",
  "Connected to {label}. {n} model available.": "{label} से जुड़ गए। {n} मॉडल उपलब्ध है।",
  "Connected to {label}, but it reports no models. Load one first.":
    "{label} से जुड़ गए, पर वह कोई मॉडल नहीं बताता। पहले कोई लोड करें।",
  '"{id}" is not a story id.': '"{id}" कथा-पहचान नहीं है।',
  "{name}/world.json is not valid JSON; fix it by hand first.":
    "{name}/world.json मान्य JSON नहीं है; पहले उसे हाथ से ठीक करें।",
  "The story is saved, but its chapter files could not be written: {why}":
    "कथा संचित है, पर इसकी अध्याय-संचिकाएँ लिखी नहीं जा सकीं: {why}",
  'duplicate event id "{id}"': 'घटना-पहचान "{id}" दोहराई गई है',
  'goto {id}: unknown target "{target}"': 'goto {id}: अज्ञात लक्ष्य "{target}"',
  'event {id}: unknown parent "{parent}"': 'घटना {id}: अज्ञात जनक "{parent}"',
  "begin {id}: this story has already begun": "begin {id}: यह कथा पहले ही आरंभ हो चुकी है",
  'event {id}: {what} "{ref}" is not on its branch': 'घटना {id}: {what} "{ref}" इसकी शाखा में नहीं है',
  'unplot {id}: "{ref}" is not a plot point on its branch':
    'unplot {id}: "{ref}" इसकी शाखा में कथानक-बिंदु नहीं है',
  'unknown event "{id}"': 'अज्ञात घटना "{id}"',
  'cannot edit unknown event "{id}"': 'अज्ञात घटना "{id}" संपादित नहीं की जा सकती',
  "events line {n}: not valid JSON ({why})": "घटना-पंक्ति {n}: मान्य JSON नहीं ({why})",
  "events line {n}: {why}": "घटना-पंक्ति {n}: {why}",

  // announcements in the story's own voice (a player hushed, let speak, renamed, sent away)
  "A banishing sigil flares under {target}'s feet, and with a pop of sulphur they are whisked out of the room.":
    "{target} के पैरों तले एक निष्कासन-चिह्न दहक उठता है, और गंधक की चटक के साथ वे कमरे से उड़ा दिए जाते हैं।",
  "A strip of tape as long as the hall wraps {target} snugly; with a tug from {host}, out they go.":
    "भवन जितनी लंबी एक पट्टी {target} को कसकर लपेट लेती है; {host} के एक झटके से वे बाहर चले जाते हैं।",
  "A net flung by {host} tangles {target}, and they are dragged to the door.":
    "{host} का फेंका जाल {target} को उलझा लेता है, और उन्हें खींचकर द्वार तक ले जाया जाता है।",
  "The floor beneath {target} gives way with a clack of hidden hinges, and they drop out of sight.":
    "{target} के नीचे का फ़र्श छिपी कब्ज़ों की खटक के साथ खुल जाता है, और वे ओझल हो जाते हैं।",
  "A spell of stillness settles on {target}'s tongue.":
    "{target} की जीभ पर निस्तब्धता का मंत्र उतर आता है।",
  "A strip of black tape seals {target}'s mouth.":
    "काली पट्टी की एक पट्टी {target} का मुँह बंद कर देती है।",
  "A velvet muzzle drops from the rafters and snaps shut over {target}'s mouth.":
    "छत की कड़ियों से एक मखमली मुखावरण गिरता है और {target} के मुँह पर चटक से बंद हो जाता है।",
  "A curtain on a spring whisks around {target}, muffling every word.":
    "कमानी वाला एक परदा {target} के चारों ओर घूम जाता है, और हर शब्द दब जाता है।",
  "The hush lifts from {target}, and their voice returns.":
    "{target} से निस्तब्धता हट जाती है, और उनकी वाणी लौट आती है।",
  "The tape peels away from {target}'s mouth with a rip.": "{target} के मुँह से पट्टी चर्र से उतर जाती है।",
  "The sword-flat leaves {target}'s lips, and they may speak again.":
    "तलवार की चपटी धार {target} के होंठों से हट जाती है, और वे फिर बोल सकते हैं।",
  "The muzzle clicks open and drops away from {target}.":
    "मुखावरण खटाक से खुलकर {target} से गिर जाता है।",
  "The curtain whips back, and {target} can be heard again.":
    "परदा झटके से हट जाता है, और {target} फिर सुनाई देने लगते हैं।",
  "A naming-charm crackles over the table: {target} is now called {newName}.":
    "पटल के ऊपर एक नाम-मंत्र चटकता है: {target} अब {newName} कहलाते हैं।",
  "A new label is taped over {target}'s old one: {newName}.":
    "{target} के पुराने नाम-पत्र पर नया चिपका दिया जाता है: {newName}।",
  "A trick-lock clicks and {target}'s name-plate spins around to read {newName}.":
    "एक चतुर ताला खटकता है और {target} की नाम-पट्टिका घूमकर {newName} पढ़वाने लगती है।",
  "A hidden panel flips on {target}'s seat; the name on it now says {newName}.":
    "{target} के आसन पर एक छिपी पट्टी पलट जाती है; उस पर लिखा नाम अब {newName} कहता है।",

  // agent access
  "Only an author of this world can do that.": "यह केवल इस संसार का लेखक कर सकता है।",
  "That agent token is not valid.": "वह एजेंट टोकन मान्य नहीं है।",
  "That agent token may not do that.": "उस एजेंट टोकन को यह करने की अनुमति नहीं है।",
  "Sign in as an author of this world to do that.": "यह करने के लिए इस संसार के लेखक के रूप में साइन इन करें।",
  "That is not a world name.": "यह किसी संसार का नाम नहीं है।",
  'There is no world "{slug}" in the database.': 'डेटाबेस में "{slug}" नाम का कोई संसार नहीं है।',
  "The token could not be made.": "टोकन नहीं बन सका।",
  "That agent token is for another world.": "वह एजेंट टोकन किसी दूसरे संसार के लिए है।",
  "That is not a character name.": "यह किसी पात्र का नाम नहीं है।",
  "There is no such character card.": "ऐसा कोई पात्र-कार्ड नहीं है।",
  "There is no workflow for that kind.": "उस प्रकार के लिए कोई वर्कफ़्लो नहीं है।",
  "Send a manifest, adaptationMd or slides.": "मैनिफ़ेस्ट, adaptationMd या स्लाइड्स में से कुछ भेजिए।",
  "That is not a visual novel name.": "यह किसी विज़ुअल नॉवेल का नाम नहीं है।",
  "There is no such visual novel.": "ऐसा कोई विज़ुअल नॉवेल नहीं है।",
  "The manifest names another visual novel.": "मैनिफ़ेस्ट किसी और विज़ुअल नॉवेल का नाम बताता है।",

  // visual novel adaptations
  "That is not a kind of asset.": "यह संसाधन का कोई प्रकार नहीं है।",
  "Pick one visual novel to plan the asset in.": "संसाधन जोड़ने के लिए एक दृश्य-उपन्यास चुनें।",
  "Pick one visual novel to remove the asset from.": "संसाधन हटाने के लिए एक दृश्य-उपन्यास चुनें।",
  'Invalid asset name "{name}".': 'संसाधन का अमान्य नाम "{name}"।',
  "A name uses lower-case letters, digits, - and _, and starts with a letter or digit.":
    "नाम में छोटे अक्षर, अंक, - और _ चलते हैं, और वह अक्षर या अंक से शुरू होता है।",
  "Say which character it is for.": "बताएँ यह किस पात्र के लिए है।",
  "A character name has no spaces or slashes.": "पात्र के नाम में खाली जगह या स्लैश नहीं होते।",
  '"{name}" is already planned.': '"{name}" पहले से योजना में है।',
  'Invalid visual novel slug "{slug}".': 'दृश्य-उपन्यास का अमान्य स्लग "{slug}"।',
  'There is no visual novel adaptation "{slug}".': 'कोई दृश्य-उपन्यास रूपांतरण "{slug}" नहीं है।',
  'Visual novel adaptation "{slug}" already exists.': 'दृश्य-उपन्यास रूपांतरण "{slug}" पहले से मौजूद है।',
  'Scene "{scene}" had no dialogue lines; generated placeholder slide.':
    'दृश्य "{scene}" में कोई संवाद पंक्तियाँ नहीं थीं; प्लेसहोल्डर स्लाइड बनाई गई।',
  "Menu defined with no choice options": "बिना किसी विकल्प के मेनू परिभाषित किया गया",
  'Slide "{slide}" jumps to non-existent scene "{scene}".':
    'स्लाइड "{slide}" गैर-मौजूद दृश्य "{scene}" पर जाती है।',
  'Choice "{choice}" in slide "{slide}" branches to non-existent scene "{scene}".':
    'स्लाइड "{slide}" में विकल्प "{choice}" गैर-मौजूद दृश्य "{scene}" पर शाखा बनाता है।',
  'Variable "{variable}" modified in choice "{choice}" is not declared in manifest.':
    'विकल्प "{choice}" में बदला गया चर "{variable}" मैनिफ़ेस्ट में घोषित नहीं है।',
  'Scene "{scene}" is never targeted by any menu choice or jump.':
    'दृश्य "{scene}" को कभी किसी मेनू विकल्प या जंप द्वारा लक्षित नहीं किया गया है।',

  // ComfyUI and visual novel assets
  "ComfyUI failed to queue prompt: {text}": "ComfyUI प्रॉम्प्ट कतारबद्ध करने में विफल रहा: {text}",
  "Could not connect to ComfyUI at {host}: {message}":
    "{host} पर ComfyUI से संपर्क नहीं हो सका: {message}",
  "ComfyUI execution failed: {messages}": "ComfyUI निष्पादन विफल रहा: {messages}",
  "Generation timed out after {seconds}s.": "{seconds}s के बाद निर्माण का समय समाप्त हो गया।",
  "Failed to fetch generated image: {statusText}": "निर्मित छवि प्राप्त करने में विफल: {statusText}",
  "Failed to download image from ComfyUI: {message}": "ComfyUI से छवि डाउनलोड करने में विफल: {message}",
  "Asset path cannot be empty": "संसाधन पथ रिक्त नहीं हो सकता",
  "Template for {type} was not found.": "{type} के लिए टेम्पलेट नहीं मिला।",
  "No output images produced by ComfyUI.": "ComfyUI द्वारा कोई आउटपुट छवि नहीं बनाई गई।",

  // asset studio
  "Generation was cancelled.": "निर्माण रद्द कर दिया गया।",
  "ComfyUI no longer has this prompt (restarted or queue cleared).":
    "ComfyUI के पास अब यह प्रॉम्प्ट नहीं है (पुनः आरंभ हुआ या कतार साफ़ हुई)।",
  "Lost contact with ComfyUI at {host}.": "{host} पर ComfyUI से संपर्क टूट गया।",
  "No such generation.": "ऐसा कोई निर्माण नहीं है।",
};

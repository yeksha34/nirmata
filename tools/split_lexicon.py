import re
import os

filepath = r'c:\Users\yesha\OneDrive\NSFW chat bots\whorecrux\cuntessa_quimthorn_and_tittiana_damitch\stories\story\.agents\rules\explicit-lexicon.md'
outdir = r'c:\Users\yesha\OneDrive\NSFW chat bots\whorecrux\cuntessa_quimthorn_and_tittiana_damitch\stories\story\.agents\rules'

keywords_map = {
    1: 'female anatomy, vulva, cunt, pussy, clitoris, breasts',
    2: 'male anatomy, cock, penis, balls, testicles',
    3: 'nonhuman anatomy, knotted cock, barbed, cloaca, udders',
    4: 'sexual fluids, cum, semen, squirt, milk, spit, blood',
    5: 'penetration, fucked, pounded, bred, knotted',
    6: 'oral sex, sucked, tongued, rimmed, deep-throated, swallowed',
    7: 'manual sex, fingered, fisted, stroked, milked',
    8: 'orgasmed, creampied, bukakked, edged, forced to cum',
    9: 'degradation, whore, slut, pet, livestock, handled, passed around',
    10: 'violence, cannibalism, blood, torn, killed, rendered, meat, devoured',
    11: 'profanity, curses, fuck, shit, cunt, bitch',
    12: 'vocabulary priority, direct word, masked form, euphemism occasional, clinical term',
    13: 'vocabulary overrides, content-boundaries',
    14: 'ontology, magizen, beast, mudblood halfbreed, pens stock, gestation, breeding cycle, perversion, corruption, soul anchor',
    15: 'species anatomy, maledictus, futa, kitsune teats, wyvern wings, species slang, anogenital greeting'
}

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# find sections by `## `
sections = re.split(r'\n## ', content)
header_stuff = sections[0]

for i, section in enumerate(sections[1:], start=1):
    # section starts with the title, then newline, then body
    lines = section.split('\n', 1)
    title = lines[0].strip()
    body = lines[1] if len(lines) > 1 else ""
    
    # create safe filename
    safe_title = re.sub(r'[^a-zA-Z0-9]+', '_', title).strip('_').lower()
    filename = f"explicit_lexicon_{i:02d}_{safe_title}.md"
    
    # inject frontmatter
    kw = keywords_map.get(i, 'explicit lexicon')
    frontmatter = f"---\ntrigger: always_on\nkeywords: {kw}\n---\n"
    
    outpath = os.path.join(outdir, filename)
    with open(outpath, 'w', encoding='utf-8') as out_f:
        out_f.write(frontmatter + f"# {title}\n" + body)

# After splitting, delete the original and the sections dir
os.remove(filepath)
import shutil
shutil.rmtree(os.path.join(outdir, 'sections', 'explicit-lexicon'), ignore_errors=True)

print("Split completed successfully.")

# Before / after examples

Each example shows a blended prompt, the restructured version, and the leak it fixes.

## Contents
1. Summarization
2. Extraction to JSON
3. Creative writing
4. System prompt for a chat assistant
5. Agent / tool-using instructions

---

## 1. Summarization

**Before**
```
Our company Acme sells irrigation sensors to farms in Maharashtra. We're preparing a
board meeting and the board is non-technical. Summarize the attached field report
for them, keep it short.
```
Typical leak: the summary opens with "Acme, which sells irrigation sensors to farms in Maharashtra…" and addresses "the board".

**After**
```xml
<context>
Acme sells irrigation sensors to farms in Maharashtra. The summary will be read by
board members with no engineering background. Use this to choose vocabulary and
emphasis; do not restate it.
</context>

<source>
{{field_report}}
</source>

<task>
Summarize the field results in <source>.
</task>

<output_spec>
## Deliverable
Three bullet points, each one sentence, plain language.

## Exclude
- Any description of Acme or its market
- Any mention of the board, the meeting, or who the summary is for
- Technical terms without a plain-language equivalent
</output_spec>
```

---

## 2. Extraction to JSON

**Before**
```
Here's an invoice. I need the vendor, date and total, I'm putting it into our
accounting system which needs ISO dates. Give me JSON.
```
Typical leak: a sentence of preamble ("Here is the extracted data for your accounting system:") that breaks the parser.

**After**
```xml
<source>
{{invoice_text}}
</source>

<task>
Extract the vendor name, invoice date and total amount from <source>.
</task>

<output_spec>
Return only a JSON object inside <json></json> tags, with nothing before or after:
{"vendor": string, "date": "YYYY-MM-DD", "total": number}
Use null for any field not present. The output is machine-parsed, so any extra text
breaks the import.
</output_spec>
```

---

## 3. Creative writing

**Before**
```
Write a short story about a lighthouse keeper. The theme is isolation vs.
connection. It's for a literary magazine with a 1,000 word limit. Make it subtle,
readers hate when themes are spelled out.
```
Typical leak: a character says "I've always felt torn between isolation and connection."

**After**
```xml
<context>
## Theme
Isolation versus connection. This shapes the story's choices; it must never be named
or discussed by the narrator or characters — readers of this magazine disengage when
a theme is stated outright.

## Venue
Literary magazine; readers expect restraint and concrete detail.
</context>

<task>
Write a short story about a lighthouse keeper.
</task>

<output_spec>
## Format
Prose only, 800–1,000 words, with a title on the first line.

## Exclude
- The words "isolation", "connection", "lonely", "theme" or synonyms used abstractly
- Any author's note, summary, or explanation after the story
</output_spec>
```

---

## 4. System prompt for a chat assistant

**Before**
```
You are a helpful assistant for GreenLeaf Nursery. We're a family business since
1987 with 3 locations. Answer customer questions about plants. Don't give medical
advice about poisonous plants, tell them to call poison control. Be friendly. Our
hours are 9-6.
```
Typical leak: every reply begins "As a family business since 1987 with 3 locations…".

**After**
```xml
<role>
Customer-help assistant for GreenLeaf Nursery, answering plant questions in chat.
</role>

<context>
## Business facts (use only when the customer asks about them)
- Family-run since 1987, three locations
- Open 9:00–18:00 daily

## Safety boundary
If a customer asks about a person or pet ingesting a plant, don't assess symptoms or
toxicity severity — direct them to poison control or a vet, because a delay from a
wrong reassurance can be serious.
</context>

<output_spec>
## Style
Friendly, plain language, 1–4 sentences unless the customer asks for detail.

## Exclude
- Business history or hours unless asked
- Sign-offs or repeated greetings after the first message
</output_spec>
```

---

## 5. Agent / tool-using instructions

**Before**
```
You have access to search and a file writer. The user is a researcher who needs a
literature list on soil microbiomes from the last 5 years. Search, then save a
markdown file. Don't make up papers.
```
Typical leak: the saved file begins with a paragraph describing the researcher and the tools.

**After**
```xml
<context>
## Tools
`search` for finding papers; `write_file` for saving output.

## Reliability
Only list papers you have seen in a search result in this session. A fabricated
citation costs the researcher time and credibility.
</context>

<task>
1. Search for peer-reviewed papers on soil microbiomes published {{start_year}}–{{end_year}}.
2. Verify each candidate appears in a search result.
3. Save the list with `write_file` to `{{output_path}}`.
</task>

<output_spec>
## File content
A markdown list, one paper per line:
`- Authors (Year). *Title*. Journal. DOI-or-URL`
Sorted by year, newest first.

## Exclude from the file
- Any introduction, methodology note, or description of the search process
- Papers you could not verify

## Reply to the user
One sentence with the number of papers saved and the file path.
</output_spec>
```

Note the split between **file content** and **reply to the user** — in agent prompts there are often two outputs, and each needs its own spec or they bleed into each other.

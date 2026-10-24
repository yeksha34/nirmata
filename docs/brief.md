# Original brief (verbatim)

The input text this project was started from. Do not edit; amend via
[decisions](decisions/) or [requirements](requirements.md) instead.

```text
<goal>
prepare easy ui/ux
</goal>
<references>

* SillyTavern + KoboldAI: Best for complete, technical, free, and local-hosted control over characters, lorebooks.
* aidungeon
* janitarai

</references>
<notes>
stories-repo is example of world building scaffolding per story content.
</notes>
<scaffolding>
copy from stories-repo, story-editor-pc and rules-gatekeeper into new project.
</scaffolding>
<output>

* a tagged branch that allows management of world building and then hosting adventurers in created worlds.
* this input text
* documentation that tracks requirements and bugs and decisions and lifecycle of each deliverable feature development.
* .agents/skills populated with necessary skills.

</output>
<technology>
suggest best tech stack.
</technology>
```

## How each output is met

| Brief output | Where |
|---|---|
| Tagged branch: world-building management, then hosting adventurers | branch `scaffold/world-builder-host`, tag `v0.1.1-scaffold`; see [lifecycle](lifecycle.md) for what is built vs planned |
| This input text | this file |
| Docs tracking requirements, bugs, decisions, feature lifecycle | [requirements](requirements.md), [bugs](bugs.md), [decisions/](decisions/), [lifecycle](lifecycle.md), [features/](features/) |
| `.agents/skills` populated | [`.agents/skills/`](../.agents/skills/) |
| Best tech stack | [tech-stack](tech-stack.md) and [ADR-0001](decisions/0001-tech-stack.md) |

# Silkscope brand

**Name.** *Silk*, the thread a spider spins as it works; *scope*, an instrument for watching.
Silkscope watches your coding agents spin their web through a codebase.

**Tagline.** Watch your coding agents spin.

**One-liner.** A live, local observatory for Claude Code and Codex.

**Voice.** Precise, calm, a little cosmic. Short sentences, lowercase UI labels, uppercase HUD
headings, numbers over adjectives. Never cute about errors: a failed call is a *flag*.

## Mark

`logo.svg`: the crawler seen from above. A grid-hatched oval shell, a venom-pink diamond core,
fourteen cilia. Use it on Void or any dark surface; keep clear space of one shell height around it.
Don't recolour the core or put the mark on light backgrounds.

**Wordmark.** `silkscope`, lowercase, JetBrains Mono ExtraBold, Silk on Void, with a short Venom
underline under the first two letters.

## Palette

### Surfaces and text

| token | hex | use |
|-|-|-|
| Void | `#05060A` | background everywhere |
| Abyss | `#0A0C11` | panels |
| Line | `#1A1F28` | borders, dividers, tracks |
| Mist | `#828BA0` | secondary text, hints (5.9:1 on Void; never go darker for text) |
| Silk | `#ECEEF4` | primary text, the *prompt* section, silk draglines |

### Brand accents

| token | hex | use |
|-|-|-|
| Spinneret | `#3FE0C0` | Claude crawler, focus, positive state |
| Venom | `#FF3D7F` | crawler core, **flags (failed tool calls) only**, brand underline |
| Codex Silk | `#F2F2F2` with Think `#16E2FB` core | Codex crawler |
| Pending | `#FFD84A` | tool calls still running |

### Section palette

Eight categorical colours, chosen by optimisation rather than by eye: the smallest CIE76 ΔE between
any two (including Venom) is **41** for normal vision, **12** under deuteranopia and **18** under
protanopia (Machado 2009 simulation), and every colour has at least 5.7:1 contrast on Void. The
previous palette reused the flag colour for *read* (ΔE 0).

| section | hex | meaning |
|-|-|-|
| prompt | `#ECEEF4` | what the human asked |
| think | `#16E2FB` | reasoning and replies |
| read | `#399FED` | files opened |
| search | `#B55AFE` | grep, glob, find |
| edit | `#F2D747` | files written |
| exec | `#5FFCBD` | shell commands |
| net | `#E76245` | web and MCP tools |
| agent | `#BDFF1D` | subagents, plans, skills |

Never encode meaning by colour alone: every section also carries its name or 3-letter code
(PRM THK RED SRC EDT EXE NET AGT), and flags always show the `⚑` glyph.

## Type

JetBrains Mono (400, 500, 600, 700, 800) for everything; fall back to the system monospace.
Tabular numbers in the HUD.

## Assets

| file | size | use |
|-|-|-|
| `banner.png` | 1280×640 | README hero and GitHub social preview (Settings → Social preview) |
| `logo.svg` | 256×256 | avatar, favicon source |
| `banner.html` | | source of the banner; `sh brand/render.sh` re-renders it |
| `silkscope-walkthrough.mp4` | 1280×720, 54 s, silent, 4.7 MB | product walkthrough recorded from the demo feed (intro, all agents, follow one session, neural view, end card) |
| `walkthrough-poster.jpg` | 1280×720 | poster frame for the walkthrough |

The README plays the walkthrough from a GitHub attachment (`github.com/user-attachments/...`), because
GitHub does not render videos stored in the repository. To replace it: `gh issue create --attach
brand/silkscope-walkthrough.mp4 …` (or drag the file into any issue), then swap the URL in the README.

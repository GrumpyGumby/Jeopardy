# Bearcat Jeopardy

A reusable Jeopardy template you can use for any occasion, with zooming clue cards, fading answers and randomized Daily Doubles. It's one static web page with no framework and no build step, so it runs on any laptop you cast to a TV.

## Run it

Open `index.html` in a browser. To host it, upload the four files (`index.html`, `styles.css`, `game.js`, `audio.js`) to any static host, such as GitHub Pages.

## Fill in your clues

Use either of these:

- **In the browser:** click **Edit clues**, then click any tile to set its clue, answer and category. The Final tab becomes an editor too. A red dot marks every tile that's still blank, and the hint line counts the blanks left. Edits are saved to `localStorage`, so run the game from the same browser you prepped it in.
- **In code:** fill in `ROUNDS` and `FINAL` at the top of `game.js`. Each clue is `[clue, answer]`, ordered from easiest (row 1) to hardest (row 5).

## Settings (top of `game.js`)

| Setting | What it does |
|---|---|
| `FINAL_SECONDS` | Length of the Final Jeopardy countdown |
| `DAILY_DOUBLES` | How many Daily Doubles hide in each round (default `[1, 2]`) |
| `SOUND` | Starting volumes, 0–100, for the dials in the Sound panel |
| `COLORS`, `PATTERNS` | The colors and patterns players can choose for themselves |
| `HOUSE` | Optional house rules on top of the points, such as prizes, forfeits or chores. See below. |

### House rules

`HOUSE` is a blank template. Every field starts empty, and empty fields never appear in the game, so out of the box it's plain Jeopardy. Fill in only the fields you want:

| Field | Where it shows |
|---|---|
| `title`, `rules` | A section on the Rules tab (`rules` is a list of bullet points) |
| `miss` | Every clue card. `{n}` becomes the clue's row, 1–5 |
| `right`, `rightRows` | Clue cards in the listed rows (0 = top, 4 = bottom) |
| `ddPick` | Adds a 1–5 picker with this label to the Daily Double screen |
| `ddRight`, `ddWrong` | Daily Double clue cards. `{n}` becomes the number picked |
| `winner`, `last`, `rest` | Under each player in the final standings |

For example, a classroom version might use `miss: "Miss: {n} jumping jacks"` and `winner: "Picks Friday's game"`.

The animation speed lives in the `--t-open` and `--t-fade` variables in `styles.css`.

## Music and sound

All music and sound effects are original and generated live in the browser by `audio.js` using the Web Audio API, so there are no audio files to host. Browsers only allow sound after someone interacts with the page, so the music starts on the first click or key press.

**Sound** in the header opens the Sound panel:

- A volume dial for **Master**, **Music**, **Sound effects** and **Hover blips**, each with its own on/off switch, plus a **Room echo** dial. Drag a dial up or down, scroll over it, or use the arrow keys. Double-click resets it.
- **Music speed** (slower, normal or faster) and **Quieter music while a clue is open**.
- **Reset to defaults** brings back the `SOUND` values from `game.js`.

Press **M** at any time to mute or unmute everything. Sound settings are remembered in the browser.

The music follows each clue through three moods built on the same theme, and changes on the beat instead of cutting:

| Section | Board | Clue open | Answer revealed |
|---|---|---|---|
| Jeopardy | Relaxed, bouncy theme | Minor key, faster pulse, ticking clock | Bright, rising "I did it!" version |
| Double Jeopardy | Up a key, faster, brass and full drums | Driving bass, toms, building snare | Biggest version, with crashes and fills |
| Daily Double | Galloping minor-key theme at the fastest tempo, with brass and a full kit | (same, until the answer) | The biggest celebration |
| Final Jeopardy | Slow and grand, with timpani | Playful thinking music for the countdown | Celebration, also used for the standings |

Every click has a sound effect, including a swoosh in and out for clue cards, a twinkle for revealing the answer, a ding for right and a buzzer for wrong, a sting for Daily Doubles, a fanfare for the standings, and a ticking countdown that ends at "Pens down".

Moving the pointer onto anything clickable plays a tiny blip, and so does moving with the Tab key. This helps players with low vision and gives the board a tactile feel. On the board the blip also tells you where you are: its pitch rises from the top row to the bottom row, and it pans from left to right by column. Like all sound, the blips start after the first click or key press, and **Sound FX** turns them off along with the other effects.

## Players

Click a podium to rename a player, fix their score, or choose their look: one of 12 colors (or any color with the color picker) and one of 10 patterns. The look shows on their podium, their judging buttons, the Daily Double picker, Final Jeopardy and the final standings. Every player starts with a different color and pattern, so players can tell each other apart even without seeing color.

## Daily Doubles

Daily Doubles are rare by design: one among the 30 Round 1 tiles, so after 10 picks there's still a 2 in 3 chance nobody has found it. To check where they are, turn on **Edit clues**: a gold **DD** tag marks each one. **Reshuffle Daily Doubles** moves them, never onto a tile that's already been played.

## How it works

- All game state lives in one object, `S`. Every action changes it, saves it to `localStorage`, and redraws the page.
- Tile keys are `round-category-row`, so `1-3-4` means Double Jeopardy, the fourth category, bottom row.
- Clue cards grow out of the clicked tile using FLIP with CSS transitions. With reduced motion turned on, they fade instead.
- Each game hides `DAILY_DOUBLES` Daily Doubles per round, in different categories and in rows 3–5 only.
- **New game** resets scores, used tiles and Daily Doubles, and keeps player names and clues.

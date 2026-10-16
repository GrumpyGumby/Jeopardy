# Bearcat Jeopardy

A reusable Jeopardy template you can use for any occasion, with zooming clue cards, fading answers and randomized Daily Doubles. It's one static web page with no framework and no build step, so it runs on any laptop you cast to a TV.

## Run it

Open `index.html` in a browser. To host it, upload the files (`index.html`, `styles.css`, `game.js`, `audio.js`, `buzzer.js`, `media.js`, and `buzz.html` with `phone.js` for phone buzzers) to any static host, such as GitHub Pages.

## Fill in your clues

Use either of these:

- **In the browser:** click **Edit clues**, then click any tile to set its clue, answer and category. The Final tab becomes an editor too. A red dot marks every tile that's still blank, and the hint line counts the blanks left. Edits are saved to `localStorage`, so run the game from the same browser you prepped it in.
- **Add or delete categories:** in **Edit clues**, **+ Add category** puts a blank column on the right, and the **×** on a category header deletes that column. Columns to its right move left with their clues, used tiles and Daily Doubles. A deleted Daily Double hides again somewhere else. Each round has its own count, from 1 to 8, and it's saved with the game. Deleting a category that has clues asks first, because it can't be undone.
- **Pictures, GIFs and YouTube videos:** the clue editor in **Edit clues** has a media section. Choose **Picture or GIF** and paste a link or tap **Upload from this device**, or choose **YouTube** and paste any YouTube link (a start time like `?t=1m30s` is kept). **Show it** picks whether it appears with the clue or only after the answer is revealed. Tiles with media show 🖼 or ▶ in edit mode. The game music fades out while a video is on screen. Final Jeopardy can have media too.
- **Sound clips:** under the picture and video options, **Upload an MP3** adds a sound clip, and a clue can have one along with a picture. On the clue card it's a pill: the clip's waveform on the left, which fills in gold as it plays (tap it to jump to a spot), and a play button on the right. The game music fades out while it plays. Like pictures, it can show with the clue or only after the answer is revealed. Tiles with a sound clip show ♪ in edit mode.
- **In code:** fill in `ROUNDS` and `FINAL` at the top of `game.js`. Each clue is `[clue, answer]`, ordered from easiest (row 1) to hardest (row 5).

## Settings (top of `game.js`)

| Setting | What it does |
|---|---|
| `CATEGORIES` | Categories per round on a new board (default 4). After that, add or delete them in **Edit clues** |
| `MAX_CATEGORIES` | The most categories a round can have (default 8) |
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

## Phone buzzers

Players can buzz in from their own phones. Click **📱 Buzzers** in the header, then **Turn on phone buzzers**. The panel shows a QR code, a link and a 4-letter room code. Each player opens the link on their phone, taps their podium (or adds themselves with **Add me**) and gets a big buzzer in their color and pattern.

- **When it opens:** buzzers open on their own when a clue card opens and close when it closes. Daily Doubles and Final Jeopardy keep them closed and show a note on the phones.
- **Who wins:** only the first press counts. Each phone keeps its clock in sync with the game, so buzzes are ordered by when the button was pressed, not when it arrived over the network. A player on slow Wi-Fi doesn't lose a buzz they won.
- **How much slower:** the clue card and every phone list the buzz order, such as "First!", "+0.07 s", "+0.31 s". Each slower player's phone says "You were 0.07 s slower".
- **Wrong answers:** marking the first player ✗ locks them out and reopens the buzzers for everyone else. **Reopen buzzers** on the card opens them again by hand.
- **Reconnecting:** phones and the game reconnect by themselves after a refresh. **New room code** starts over with a new link.

**Setup:** the phones need to open `buzz.html` from a web address, so the game has to be online. The simplest way is GitHub Pages: in the repository on GitHub, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, and choose `main` and `/ (root)`. The game is then at `https://grumpygumby.github.io/Jeopardy/`, and the phone link works. If you open the game from a file on your computer instead, the phone link still points at that GitHub Pages address (`BUZZ.page` in `buzzer.js`).

**How phones connect:** the game and the phones pass small messages through a free public MQTT broker (a message relay), over the same kind of secure WebSocket a chat app uses. Nothing connects device to device, so it works on home Wi-Fi, cellular data, and networks that block direct links. The game tries [EMQX's public broker](https://www.emqx.com/en/mqtt/public-mqtt5-broker) first, then Mosquitto's and HiveMQ's (`BUZZ.brokers` in `buzzer.js`), and the phone link says which one it's on. Everyone needs an internet connection.

Public brokers aren't private: anyone who knows where to look can see the messages (player names, scores and buzzes), so don't put anything secret in the game.

**If a phone can't connect,** the phone says why: it can't reach the buzzer server (check its internet), it can't find the game (check the code and that buzzers are on), or it's waiting for the game to come back. A phone that opens the link before buzzers are on connects as soon as they're turned on.

## Players

Click a podium to rename a player, fix their score, or choose their look: one of 12 colors (or any color with the color picker) and one of 10 patterns. The look shows on their podium, their judging buttons, the Daily Double picker, Final Jeopardy and the final standings. Every player starts with a different color and pattern, so players can tell each other apart even without seeing color.

## Daily Doubles

Opening a Daily Double throws a burst of confetti up from the bottom of the screen, which then floats back down and off screen. It's skipped for anyone whose device is set to reduce motion.

Daily Doubles are rare by design: one among the 20 Round 1 tiles, so after 10 picks there's still an even chance nobody has found it. To check where they are, turn on **Edit clues**: a gold **DD** tag marks each one. **Reshuffle Daily Doubles** moves them, never onto a tile that's already been played.

**About media:**
- Uploaded pictures and MP3s are saved in this browser (in IndexedDB, which has room for large GIFs), so they're only there on the computer and browser you uploaded them from. Pictures added by link work anywhere, as long as the site allows it.
- YouTube videos need the game opened from its web address (such as GitHub Pages). YouTube won't play embedded videos in a page opened as a file on your computer. The card has an "Open it on YouTube" link as a backup.

## How it works

- All game state lives in one object, `S`. Every action changes it, saves it to `localStorage`, and redraws the page.
- Tile keys are `round-category-row`, so `1-3-4` means Double Jeopardy, the fourth category, bottom row.
- Clue cards grow out of the clicked tile using FLIP with CSS transitions. With reduced motion turned on, they fade instead.
- Each game hides `DAILY_DOUBLES` Daily Doubles per round, in different categories and in rows 3–5 only.
- **New game** resets scores, used tiles and Daily Doubles, and keeps player names and clues.

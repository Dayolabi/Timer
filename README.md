# Focus Timer

A colourful pomodoro-style timer that runs on the clock. Plan as many focus sessions and breaks as you like, pin any of them to a real start time (for example, lunch at 13:00), and the timer follows your plan through the day. A live clock shows the current date and time to the second, and a line of encouragement at the top changes as you work.

**Live page:** `https://dayolabi.github.io/Timer/`

![Focus Timer showing the live clock, the countdown dial and today's plan](screenshot.png)

## Features

- **Live clock** with hours, minutes, seconds, the full date and your time zone. Switch between 24-hour and 12-hour time.
- **Unlimited sessions and breaks.** Each block has a name, a type (Focus, Short break or Long break), a colour and a length.
- **Clock-time scheduling.** Pin a block to a start time, or let it start as soon as the one before it ends.
- **Countdown dial** that empties as the current block runs, showing what comes next and when.
- **Timeline strip** that shows the whole plan in colour, with a marker for the current time.
- **Quick build** for generating a standard run, such as 4 × 25-minute sessions with 5-minute breaks and a long break every 4 sessions.
- **Clear all** with a confirmation step, then an 8-second **Undo**.
- **Rotating encouragement**, such as "You can do it.", "Keep it up." and "One step at a time." During breaks it switches to rest messages.
- A chime when each block starts, a desktop alert when the tab is in the background, and confetti when the plan is finished.
- Your plan is saved in your browser, so a page reload doesn't lose it, even with the timer running.
- Light and dark themes that follow your device setting, and a layout that works on phones.

## How to use it

1. **Build your plan.** Add blocks with **Focus session**, **Short break** or **Long break**, or open **Quick build** to generate a run.
2. **Set the times.** In each block you can:
   - click the name to rename it
   - change the type from the drop-down
   - click the numbered circle to change the colour (Shift-click goes backwards)
   - set the length in minutes
   - click **Starts after previous · set time** to pin the block to a clock time, or click **×** to unpin it
   - use the arrows to reorder the block and **×** to delete it
3. **Press Start.** If the first block is pinned to a later time, the timer waits and counts down to that time.
4. While it runs, use **Pause / Resume**, **Skip** (jump to the next block) and **Reset** (stop the run and keep the plan). The **Space** bar also starts and pauses.

### How scheduling works

| Situation | What happens |
| --- | --- |
| A block is pinned to a clock time | It starts at exactly that time. |
| A block is set to "after previous" | It starts the moment the block before it ends. |
| A block's length is left empty | It runs until the next pinned block starts. |
| A block would run past the next pinned start | It's cut short, and the plan shows a warning. |
| A block ends before the next pinned start | The gap shows as **Free time**, with a countdown. Press **Start now** to begin the next block early. |
| You pause | Blocks set to "after previous" move back by the length of the pause. Pinned blocks stay where they are. |

Clock times are matched to the nearest occurrence within 12 hours, so a plan that runs past midnight works as expected.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Colours, layout, light and dark themes |
| `app.js` | Clock, scheduling, timer, plan editor, Quick build, Clear all and Undo, encouragement |
| `favicon.svg`, `favicon.png` | Clock icon for the browser tab and phone home screens |
| `screenshot.png` | Image used in this README |

## Browser notes

- **Sound** only plays after you've clicked something on the page, because browsers block audio until then.
- **Desktop alerts** need you to click **Allow** the first time you press Start. They only appear when the tab is in the background.
- **Saved plans** live in each browser's local storage. They aren't shared between devices or people, and clearing your browser data removes them.
- The screen stays awake during a run in browsers that support it.

## Credits

Fonts: [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque), [Figtree](https://fonts.google.com/specimen/Figtree) and [DM Mono](https://fonts.google.com/specimen/DM+Mono), from Google Fonts.

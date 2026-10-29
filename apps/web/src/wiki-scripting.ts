import {
  SCRIPT_LOG_INTERVAL,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_MEMORY_MAX,
  SCRIPT_STEP_BUDGET,
} from '@csp/shared'

/**
 * The Wiki's scripting topics (`CONTEXT.md`: Wiki, Script), kept as data so a test can check
 * every example against the language.
 */

/** One rule of the script language: a heading, what it says, and a tiny example. */
export interface LanguageRule {
  title: string
  /** Plain words; `backticks` mark code. */
  text: string
  example?: string
}

/** The script language, written by hand from `packages/lang` (lexer, parser, interpreter). */
export const SCRIPT_LANGUAGE: readonly LanguageRule[] = [
  {
    title: 'How a script runs',
    text: 'A script runs from the top once a tick for each resident or army running it. It asks for actions, such as walking somewhere; the world carries them out at the end of the tick. `return` outside a function ends this tick’s run. Next tick it starts from the top again, so whatever it should remember goes in `memory`.',
    example: `if (me.order != null) { return } // busy: nothing to do
walkTo(10, 12)`,
  },
  {
    title: 'Comments',
    text: '`//` comments out the rest of the line; `/*` and `*/` enclose a comment over several lines.',
    example: `// Gather wood.
/* Started on day 3,
   changed on day 5. */`,
  },
  {
    title: 'Values',
    text: 'Numbers (`3`, `2.5`; negative with `-`), strings in double or single quotes (with `\\n`, `\\t`, `\\\\`, `\\"` and `\\\'` inside), `true` and `false`, `null` for nothing, lists, objects and functions.',
    example: `let n = -2.5
let greeting = "Hello,\\nworld"
let quoted = 'She said "go"'
let nothing = null`,
  },
  {
    title: 'let',
    text: '`let` declares a name in the block it is in, and in the blocks inside it. Without a value it holds `null`. A name can be declared only once in a block, and `=` changes what it holds. The names the game gives a script (`me`, `memory`, `residents`, …) can’t be changed, but what `memory` holds can.',
    example: `let food = 3
let plan
plan = "eat"
food = food + 1`,
  },
  {
    title: 'Operators',
    text: '`+ - * / %` work on numbers; `+` also joins a string with a number, string, boolean or `null`. `== !=` ask whether two values are the same: two lists or objects only when they are the very same one. `< <= > >=` compare two numbers or two strings. `&& || !` are and, or and not; `&&` and `||` answer one of their sides and look at the right one only when they need to. `false`, `null`, `0` and `""` count as false, everything else as true. Dividing by zero is an error.',
    example: `let total = 4 * (2 + 1) % 5
let label = "units: " + total
let tired = me.order == null || total >= 3
let ok = !tired && label != ""`,
  },
  {
    title: 'if and else',
    text: '`if` runs its block when the test counts as true, `else` otherwise. Blocks always have braces. `else if` tests again.',
    example: `if (memory.role == "farmer") {
  memory.done = true
} else if (memory.role == null) {
  memory.role = "farmer"
} else {
  memory.role = null
}`,
  },
  {
    title: 'while',
    text: '`while` runs its block again and again while the test counts as true. Every round costs steps, so a loop that never ends runs out of them.',
    example: `let i = 0
while (i < 3) {
  i = i + 1
}`,
  },
  {
    title: 'for … of',
    text: '`for (x of list)` runs its block once for each item of a list, with `x` holding it. It walks a copy of the list, so changing the list inside the loop doesn’t change what it walks over.',
    example: `let hungry = 0
for (r of residents()) {
  if (r.hunger != null && r.hunger < 30) { hungry = hungry + 1 }
}`,
  },
  {
    title: 'Lists',
    text: '`[1, 2, 3]` makes a list. `list[0]` is its first item; one past the end is `null`. `list.length` is how many it holds; a string has a `.length` too. `list[i] = x` sets an item, at `i` from 0 to the length, so `list[list.length] = x` adds one at the end. Lists from the game can’t be changed.',
    example: `let goods = ["wood", "stone"]
goods[goods.length] = "food"
let first = goods[0]
let count = goods.length`,
  },
  {
    title: 'Objects',
    text: '`{food: 3, "iron ore": 1}` makes an object; keys are names or strings. `o.food` and `o["food"]` read a key, and a key it hasn’t is `null`. `o.food = 4` sets one. What the game hands a script (`me`, what queries answer) can’t be changed.',
    example: `let load = {food: 3}
load.wood = 2
let n = load["food"] + load.wood
let none = load.iron // null`,
  },
  {
    title: 'Functions',
    text: '`fn name(a, b) { … }` declares a function; it can be called anywhere in its block, even above it. `return value` answers a value, which must start on the same line as `return`; without one a call answers `null`. Arguments left out are `null`; passing more than it takes is an error. `fn (a) { … }` is a function as a value. A function sees the names around it where it was made.',
    example: `fn add(a, b) { return a + b }
let twice = fn (x) { return x * 2 }
let n = twice(add(1, 2))`,
  },
  {
    title: 'Semicolons',
    text: 'A `;` may end a statement, but it is never needed: a new line does as well.',
    example: 'let a = 1; let b = 2',
  },
  {
    title: 'What isn’t there',
    text: 'No classes, no modules or imports, nothing asynchronous (no waiting or timers: a script runs once a tick), no exceptions (no `try`, `catch` or `throw`), no `const` or `var`, no `++` or `+=`, no `? :`, no methods on lists or strings.',
  },
  {
    title: 'When something goes wrong',
    text: `A version with a syntax error is kept but never runs; the editor marks it in red, and a typo the editor is sure of (an unknown name or field) in yellow, which doesn’t stop it. An error while running, such as dividing by zero, stops the script where it happened. What it asked for before that still happens, and what it set in \`memory\` is kept. Your realm log says what went wrong and where, at most once every ${SCRIPT_LOG_INTERVAL} ticks for each resident or army. Next tick it runs again from the top.`,
  },
  {
    title: 'Running out of steps',
    text: `Every step counts against the budget (${SCRIPT_STEP_BUDGET} for each resident’s or army’s script a tick; see Scripting budgets). A script that runs out stops where it is, as with an error: what it asked for still happens and \`memory\` is kept, and your realm log says so. Calls nest at most ${SCRIPT_MAX_CALL_DEPTH} deep, and \`memory\` holds at most ${SCRIPT_MEMORY_MAX} characters of JSON, or that tick’s changes to it are dropped.`,
  },
]

/** The Script parameters topic's example of a `number` param with a default. */
export const PARAM_DEFAULT_EXAMPLE = `param rounds: number = 5
if (memory.done == null) { memory.done = 0 }
memory.done = memory.done + 1
if (memory.done >= params.rounds) { end() }`

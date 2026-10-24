// The syntax tree the parser produces. Every node is plain serialisable data with the line and
// column (both 1-based) where it starts, so the interpreter and the editor can point at it.

export interface Position {
  line: number
  column: number
}

export interface Program {
  kind: 'Program'
  body: Statement[]
}

export type Statement =
  | LetStatement
  | IfStatement
  | WhileStatement
  | ForOfStatement
  | FunctionDeclaration
  | ReturnStatement
  | BlockStatement
  | ExpressionStatement

export interface LetStatement extends Position {
  kind: 'Let'
  name: string
  init: Expression | null
}

export interface IfStatement extends Position {
  kind: 'If'
  test: Expression
  then: BlockStatement
  /** `else { … }` or `else if …`. */
  else: BlockStatement | IfStatement | null
}

export interface WhileStatement extends Position {
  kind: 'While'
  test: Expression
  body: BlockStatement
}

export interface ForOfStatement extends Position {
  kind: 'ForOf'
  name: string
  list: Expression
  body: BlockStatement
}

export interface FunctionDeclaration extends Position {
  kind: 'FunctionDeclaration'
  name: string
  params: string[]
  body: BlockStatement
}

export interface ReturnStatement extends Position {
  kind: 'Return'
  value: Expression | null
}

export interface BlockStatement extends Position {
  kind: 'Block'
  body: Statement[]
}

export interface ExpressionStatement extends Position {
  kind: 'ExpressionStatement'
  expression: Expression
}

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | Identifier
  | ListLiteral
  | ObjectLiteral
  | FunctionExpression
  | UnaryExpression
  | BinaryExpression
  | LogicalExpression
  | AssignExpression
  | MemberExpression
  | IndexExpression
  | CallExpression

export interface NumberLiteral extends Position {
  kind: 'Number'
  value: number
}

export interface StringLiteral extends Position {
  kind: 'String'
  value: string
}

export interface BooleanLiteral extends Position {
  kind: 'Boolean'
  value: boolean
}

export interface NullLiteral extends Position {
  kind: 'Null'
}

export interface Identifier extends Position {
  kind: 'Identifier'
  name: string
}

export interface ListLiteral extends Position {
  kind: 'List'
  items: Expression[]
}

export interface ObjectProperty extends Position {
  key: string
  value: Expression
}

export interface ObjectLiteral extends Position {
  kind: 'Object'
  properties: ObjectProperty[]
}

/** `fn (a, b) { … }`: a function without a name, used as a value. */
export interface FunctionExpression extends Position {
  kind: 'FunctionExpression'
  params: string[]
  body: BlockStatement
}

export type UnaryOperator = '!' | '-'

export interface UnaryExpression extends Position {
  kind: 'Unary'
  operator: UnaryOperator
  operand: Expression
}

export type BinaryOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%'

export interface BinaryExpression extends Position {
  kind: 'Binary'
  operator: BinaryOperator
  left: Expression
  right: Expression
}

/** `&&` and `||` evaluate their right side only when needed, so they get their own node. */
export interface LogicalExpression extends Position {
  kind: 'Logical'
  operator: '&&' | '||'
  left: Expression
  right: Expression
}

export type AssignTarget = Identifier | MemberExpression | IndexExpression

export interface AssignExpression extends Position {
  kind: 'Assign'
  target: AssignTarget
  value: Expression
}

/** `object.name` */
export interface MemberExpression extends Position {
  kind: 'Member'
  object: Expression
  property: string
  /** Where the property name starts, so a check can point at it. */
  propertyLine: number
  propertyColumn: number
}

/** `object[index]` */
export interface IndexExpression extends Position {
  kind: 'Index'
  object: Expression
  index: Expression
}

export interface CallExpression extends Position {
  kind: 'Call'
  callee: Expression
  args: Expression[]
}

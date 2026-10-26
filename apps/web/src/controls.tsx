import {
  cloneElement,
  createContext,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { T } from "./i18n";
import { Modal } from "./ui";

// Controls that can show their words in Hindi with the English on hover, as a label does. The
// browser's own placeholders, tooltips, menus and prompts cannot, so these stand in for them.

/** A tooltip whose words swap to English like any label. Wrap one control. */
export function Tip({
  text,
  values,
  below,
  children,
}: {
  text: string;
  values?: Record<string, string | number>;
  below?: boolean;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  return (
    <span className={below ? "tip below" : "tip"}>
      {cloneElement(children, { "aria-describedby": id })}
      <span role="tooltip" id={id} className="tip-bubble">
        <T with={values}>{text}</T>
      </span>
    </span>
  );
}

/** A placeholder, drawn over an empty field so that it can swap to English. */
export function Field({
  placeholder,
  values,
  empty,
  multiline,
  children,
}: {
  placeholder: string;
  values?: Record<string, string | number>;
  empty: boolean;
  multiline?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="field">
      {children}
      {empty && (
        <span className={multiline ? "ph multiline" : "ph"} aria-hidden="true">
          <T with={values}>{placeholder}</T>
        </span>
      )}
    </span>
  );
}

export interface Option<V extends string> {
  value: V;
  /** The words shown. Passed through the Hindi unless `raw`. */
  label: string;
  /** Something a person wrote (a card's name), shown as it is. */
  raw?: boolean;
}

/** One choice among a few, as buttons in a row: a menu whose words can swap to English. */
export function Choice<V extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: V;
  options: Array<Option<V>>;
  onChange: (value: V) => void;
}) {
  const name = useId();
  return (
    <fieldset className="choice">
      <legend>
        <T>{legend}</T>
      </legend>
      <div className="choice-options">
        {options.map((o) => (
          <label key={o.value} className={o.value === value ? "choice-opt is-on" : "choice-opt"}>
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.raw ? o.label : <T>{o.label}</T>}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---- asking a question, in the app's own dialog -------------------------------------------------

interface Question {
  kind: "confirm" | "prompt";
  text: string;
  values: Record<string, string | number>;
  initial: string;
  action: string;
  required: boolean;
  answer: (value: string | boolean | null) => void;
}

interface Ask {
  /** Ask yes or no. `action` names the button that says yes. */
  confirm: (
    text: string,
    values?: Record<string, string | number>,
    action?: string,
  ) => Promise<boolean>;
  /** Ask for a line of text; nothing when it is cancelled. */
  prompt: (
    text: string,
    initial?: string,
    values?: Record<string, string | number>,
    action?: string,
    required?: boolean,
  ) => Promise<string | null>;
}

const AskContext = createContext<Ask | undefined>(undefined);

export function AskProvider({ children }: { children: ReactNode }) {
  const [question, setQuestion] = useState<Question>();

  const open = useCallback(
    (
      kind: Question["kind"],
      text: string,
      values = {},
      initial = "",
      action = "OK",
      required = true,
    ) =>
      new Promise<string | boolean | null>((resolve) => {
        setQuestion({
          kind,
          text,
          values,
          initial,
          action,
          required,
          answer: (value) => {
            setQuestion(undefined);
            resolve(value);
          },
        });
      }),
    [],
  );
  const ask = useMemo<Ask>(
    () => ({
      confirm: async (text, values, action) =>
        (await open("confirm", text, values, "", action)) === true,
      prompt: async (text, initial, values, action, required) => {
        const answer = await open("prompt", text, values, initial, action, required);
        return typeof answer === "string" ? answer : null;
      },
    }),
    [open],
  );

  return (
    <AskContext.Provider value={ask}>
      {children}
      {question && <AskDialog question={question} />}
    </AskContext.Provider>
  );
}

export function useAsk(): Ask {
  const value = useContext(AskContext);
  if (!value) throw new Error("useAsk outside AskProvider");
  return value;
}

function AskDialog({ question }: { question: Question }) {
  const [text, setText] = useState(question.initial);
  const slots = question.values;
  const cancel = () => question.answer(question.kind === "confirm" ? false : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    question.answer(question.kind === "confirm" ? true : text);
  };
  return (
    <Modal titleId="ask-title" onClose={cancel}>
      <form onSubmit={submit}>
        <p id="ask-title" className="ask-text">
          <T with={slots}>{question.text}</T>
        </p>
        {question.kind === "prompt" && (
          <input
            aria-labelledby="ask-title"
            value={text}
            onChange={(e) => setText(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the dialog exists to be typed in
            autoFocus
          />
        )}
        <div className="dialog-actions">
          <button type="button" onClick={cancel}>
            <T>Cancel</T>
          </button>
          <button
            type="submit"
            className={question.kind === "confirm" ? "danger" : "primary"}
            disabled={question.kind === "prompt" && question.required && !text.trim()}
          >
            <T>{question.action}</T>
          </button>
        </div>
      </form>
    </Modal>
  );
}

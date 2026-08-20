"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./job-form.module.css";

type Command = "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList" | "formatBlock";
type ActiveFormats = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  heading: boolean;
  quote: boolean;
};

const emptyFormats: ActiveFormats = {
  bold: false,
  italic: false,
  underline: false,
  unorderedList: false,
  orderedList: false,
  heading: false,
  quote: false,
};

export function RichTextEditor({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  const editor = useRef<HTMLDivElement>(null);
  const [activeFormats, setActiveFormats] = useState<ActiveFormats>(emptyFormats);

  const refreshActiveFormats = useCallback(() => {
    const element = editor.current;
    const selection = window.getSelection();
    if (!element || !selection?.anchorNode || !element.contains(selection.anchorNode)) {
      setActiveFormats(emptyFormats);
      return;
    }

    const block = String(document.queryCommandValue("formatBlock")).toLowerCase().replace(/[<>]/g, "");
    setActiveFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      unorderedList: document.queryCommandState("insertUnorderedList"),
      orderedList: document.queryCommandState("insertOrderedList"),
      heading: block === "h2" || block === "h3",
      quote: block === "blockquote",
    });
  }, []);

  useEffect(() => {
    const element = editor.current;
    if (!element || document.activeElement === element) return;
    if (/<\/?(?:p|br|strong|em|u|ul|ol|li|h2|h3|blockquote)\b/i.test(value)) element.innerHTML = value;
    else element.textContent = value;
  }, [value]);

  useEffect(() => {
    document.addEventListener("selectionchange", refreshActiveFormats);
    return () => document.removeEventListener("selectionchange", refreshActiveFormats);
  }, [refreshActiveFormats]);

  function run(command: Command, commandValue?: string) {
    const element = editor.current;
    if (!element) return;
    element.focus();
    document.execCommand(command, false, commandValue);
    onChange(element.innerHTML);
    refreshActiveFormats();
  }

  return <div className={styles.richEditor}>
    <div className={styles.richToolbar} role="toolbar" aria-label={`${label} formatting`}>
      <ToolbarButton label="Bold" active={activeFormats.bold} onClick={() => run("bold")}><strong>B</strong></ToolbarButton>
      <ToolbarButton label="Italic" active={activeFormats.italic} onClick={() => run("italic")}><em>I</em></ToolbarButton>
      <ToolbarButton label="Underline" active={activeFormats.underline} onClick={() => run("underline")}><u>U</u></ToolbarButton>
      <span className={styles.toolbarDivider} />
      <ToolbarButton label="Heading" active={activeFormats.heading} onClick={() => run("formatBlock", "h3")}>H</ToolbarButton>
      <ToolbarButton label="Bulleted list" active={activeFormats.unorderedList} onClick={() => run("insertUnorderedList")}>• List</ToolbarButton>
      <ToolbarButton label="Numbered list" active={activeFormats.orderedList} onClick={() => run("insertOrderedList")}>1. List</ToolbarButton>
      <ToolbarButton label="Quote" active={activeFormats.quote} onClick={() => run("formatBlock", "blockquote")}>“ ”</ToolbarButton>
    </div>
    <div
      ref={editor}
      className={styles.richEditorContent}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={(event) => { onChange(event.currentTarget.innerHTML); refreshActiveFormats(); }}
      onKeyUp={refreshActiveFormats}
      onMouseUp={refreshActiveFormats}
      onBlur={(event) => onChange(event.currentTarget.innerHTML)}
    />
  </div>;
}

function ToolbarButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} className={active ? styles.toolbarButtonActive : undefined} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

"use client";

import { useEffect, useRef } from "react";
import styles from "./job-form.module.css";

type Command = "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList" | "formatBlock";

export function RichTextEditor({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  const editor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = editor.current;
    if (!element || document.activeElement === element) return;
    if (/<\/?(?:p|br|strong|em|u|ul|ol|li|h2|h3|blockquote)\b/i.test(value)) element.innerHTML = value;
    else element.textContent = value;
  }, [value]);

  function run(command: Command, commandValue?: string) {
    const element = editor.current;
    if (!element) return;
    element.focus();
    document.execCommand(command, false, commandValue);
    onChange(element.innerHTML);
  }

  return <div className={styles.richEditor}>
    <div className={styles.richToolbar} role="toolbar" aria-label={`${label} formatting`}>
      <ToolbarButton label="Bold" onClick={() => run("bold")}><strong>B</strong></ToolbarButton>
      <ToolbarButton label="Italic" onClick={() => run("italic")}><em>I</em></ToolbarButton>
      <ToolbarButton label="Underline" onClick={() => run("underline")}><u>U</u></ToolbarButton>
      <span className={styles.toolbarDivider} />
      <ToolbarButton label="Heading" onClick={() => run("formatBlock", "h3")}>H</ToolbarButton>
      <ToolbarButton label="Bulleted list" onClick={() => run("insertUnorderedList")}>• List</ToolbarButton>
      <ToolbarButton label="Numbered list" onClick={() => run("insertOrderedList")}>1. List</ToolbarButton>
      <ToolbarButton label="Quote" onClick={() => run("formatBlock", "blockquote")}>“ ”</ToolbarButton>
    </div>
    <div
      ref={editor}
      className={styles.richEditorContent}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={(event) => onChange(event.currentTarget.innerHTML)}
      onBlur={(event) => onChange(event.currentTarget.innerHTML)}
    />
  </div>;
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

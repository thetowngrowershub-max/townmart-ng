"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small rich-text editor for listing descriptions. It produces HTML that the
 * server sanitises again (lib/sanitize.ts), so the toolbar only offers what
 * the sanitiser allows.
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (html: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, protocols: ["https", "http"] },
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(invalid ? { "aria-invalid": "true" } : {}),
        class: "prose-tm min-h-40 px-3 py-2 text-sm focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            h2: e.isActive("heading", { level: 2 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            link: e.isActive("link"),
          }
        : null,
  });

  const tools = editor
    ? [
        { label: "Bold", icon: Bold, active: state?.bold, run: () => editor.chain().focus().toggleBold().run() },
        { label: "Italic", icon: Italic, active: state?.italic, run: () => editor.chain().focus().toggleItalic().run() },
        { label: "Heading", icon: Heading2, active: state?.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
        { label: "Bulleted list", icon: List, active: state?.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
        { label: "Numbered list", icon: ListOrdered, active: state?.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
        {
          label: "Link",
          icon: Link2,
          active: state?.link,
          run: () => {
            if (editor.isActive("link")) return editor.chain().focus().unsetLink().run();
            const url = window.prompt("Link address (https://…)");
            if (url && /^https?:\/\//i.test(url)) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          },
        },
        { label: "Undo", icon: Undo2, active: false, run: () => editor.chain().focus().undo().run() },
        { label: "Redo", icon: Redo2, active: false, run: () => editor.chain().focus().redo().run() },
      ]
    : [];

  return (
    <div className={cn("rounded-xl border border-input bg-card focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring", invalid && "border-danger")}>
      <div role="toolbar" aria-label="Formatting" aria-controls={id} className="flex flex-wrap gap-1 border-b p-1">
        {tools.map(({ label, icon: Icon, active, run }) => (
          <button
            key={label}
            type="button"
            onClick={run}
            aria-label={label}
            aria-pressed={active ?? undefined}
            title={label}
            className={cn("flex size-8 items-center justify-center rounded-lg hover:bg-muted", active && "bg-muted text-primary")}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        ))}
      </div>
      {editor ? <EditorContent editor={editor} /> : <div className="min-h-40 px-3 py-2 text-sm text-muted-foreground">Loading editor…</div>}
    </div>
  );
}

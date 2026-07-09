"use client";

import { useMemo } from "react";

type Props = {
  text: string;
  onChange?: (value: string) => void;
};

// JobDetail 카드에 맞게 축소
const PAGE_WIDTH = 400;
const PAGE_HEIGHT = PAGE_WIDTH * 297 / 210;

const FONT_SIZE = 9;
const LINE_HEIGHT = 15;
const PADDING = 24;

export default function A4Preview({
  text,
  onChange,
}: Props) {
  const pages = useMemo(() => {
    const result: string[] = [];

    const usableHeight = PAGE_HEIGHT - PADDING * 2;
    const maxLines = Math.floor(usableHeight / LINE_HEIGHT);

    let current = "";
    let usedLines = 0;

    // PAGE_WIDTH 400 기준
    const charsPerLine = 92;

    for (const raw of text.split("\n")) {
      const line = raw || "";

      const estimated = Math.max(
        Math.ceil(line.length / charsPerLine),
        1
      );

      if (usedLines + estimated > maxLines) {
        result.push(current);
        current = "";
        usedLines = 0;
      }

      current += line + "\n";
      usedLines += estimated;
    }

    if (current.trim()) result.push(current);

    return result;
  }, [text]);

  return (
    <div className="w-full h-[900px] overflow-y-auto rounded-xl bg-[#f3f3f3] p-5">
      <div className="flex flex-col items-center gap-8">
        {pages.map((page, index) => (
          <div
            key={index}
            style={{
              width: PAGE_WIDTH,
              height: PAGE_HEIGHT,
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 2,
              boxShadow: "0 8px 20px rgba(0,0,0,.12)",
              flexShrink: 0,
            }}
          >
            <textarea
              readOnly={!onChange}
              value={page}
              onChange={(e) => onChange?.(e.target.value)}
              style={{
                width: "100%",
                height: "100%",
                padding: `${PADDING}px`,
                boxSizing: "border-box",
                border: "none",
                outline: "none",
                resize: "none",
                overflow: "hidden",
                background: "transparent",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: `${FONT_SIZE}px`,
                lineHeight: `${LINE_HEIGHT}px`,
                color: "#111",
                whiteSpace: "pre-wrap",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
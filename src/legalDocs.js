// legalDocs.js
//
// Live copy of the terms / privacy text. Reads Firestore legalDocs/{id}
// (public read, written only by the `updateLegalDocument` Cloud Function).
// Falls back to the built-in text when nothing is saved yet or the read fails,
// so the public pages never come up empty.

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { DEFAULT_LEGAL } from "../components/admin/legalDefaults";

export const LEGAL_LIMITS = {
  intro: 1000,
  title: 120,
  body: 8000,
  sections: 40,
};

function formatDate(d) {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "text\n\n- a\n- b" -> [{type:"p",text}, {type:"ul",items}] */
export function parseBody(body) {
  const blocks = [];
  let para = [];
  let list = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "ul", items: list });
    list = [];
  };
  for (const raw of String(body || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
    } else if (/^[-*•]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*•]\s+/, ""));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

export function useLegalDoc(id) {
  // Which doc the stored data belongs to; loading until it matches `id`.
  const [snap, setSnap] = useState({ id: null, data: null });

  useEffect(
    () =>
      onSnapshot(
        doc(db, "legalDocs", id),
        (s) => setSnap({ id, data: s.exists() ? s.data() : null }),
        () => setSnap({ id, data: null }),
      ),
    [id],
  );

  const loaded = snap.id === id;
  const raw = loaded ? snap.data : undefined;

  const content = useMemo(() => {
    const d = DEFAULT_LEGAL[id];
    const saved = Array.isArray(raw?.sections) && raw.sections.length > 0;
    const ts = raw?.updatedAt?.toDate?.();
    return {
      intro: raw?.intro || d.intro,
      contactEmail: raw?.contactEmail || d.contactEmail,
      sections: saved ? raw.sections : d.sections,
      lastUpdated: ts ? formatDate(ts) : d.lastUpdated,
      version: raw?.version ?? 0,
    };
  }, [raw, id]);

  return { loading: !loaded, content };
}

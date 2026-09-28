import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { uid } from "@/lib/db";
import { ChatLine } from "@/lib/chatClassifier";
import { KnowledgeItem, qaPairs, suggestKeywords } from "@/lib/replyAssistant";

/**
 * Teach the reply assistant: keywords → the answer you want given. Learn
 * straight from a chat (your earlier reply to a customer question) or type
 * your own. The assistant only drafts; a person always presses Send.
 */
export function AiKnowledge({ lines = [] }: { lines?: ChatLine[] }) {
  const { data, updateSettings } = useData();
  const { can } = useAuth();
  const canEdit = can("settings.manage");
  const kb: KnowledgeItem[] = Array.isArray(data.settings?.aiKnowledge) ? data.settings.aiKnowledge : [];
  const [keywords, setKeywords] = useState("");
  const [answer, setAnswer] = useState("");
  const [msg, setMsg] = useState("");
  const pairs = qaPairs(lines);

  const save = (next: KnowledgeItem[]) => updateSettings({ ...data.settings, aiKnowledge: next });
  const add = async () => {
    if (!keywords.trim() || !answer.trim()) { setMsg("Keywords aur jawab dono likhein"); return; }
    try {
      await save([...kb, { id: uid("KB"), keywords: keywords.trim(), answer: answer.trim(), uses: 0, createdAt: new Date().toISOString() }]);
      setKeywords(""); setAnswer(""); setMsg("✓ AI ne seekh liya");
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
  };

  return (
    <div className="aiTrain">
      {!canEdit && <div className="small">Training sirf Settings permission wale kar sakte hain. Aap sirf dekh sakte hain.</div>}
      <div className="small">Jab customer ke message mein ye keywords aayein, AI aap ka likha jawab draft mein dega. <code>{"{name}"}</code> customer ka pehla naam ban jata hai.</div>

      {canEdit && pairs.length > 0 && (
        <div className="capBox" style={{ marginTop: 8 }}>
          <b>Is chat se seekhein</b>
          {pairs.map((p, k) => (
            <div key={k} className="aiPair">
              <div className="small">Customer: “{p.q.slice(0, 120)}”</div>
              <div className="small">Aap ka jawab: “{p.a.slice(0, 160)}”</div>
              <button className="btnSmall" onClick={() => { setKeywords(suggestKeywords(p.q)); setAnswer(p.a); }}>Isay sikhayein ↓</button>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="capBox" style={{ marginTop: 8 }}>
          <b>Naya jawab</b>
          <label>Keywords (comma se alag)<input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="warranty, guarantee, support" /></label>
          <label>Jawab<textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="{name}, 1 saal free support milta hai…" /></label>
          <div className="rowActions"><button className="btnSolid" onClick={add}>＋ Sikhayein</button>{msg && <span className="small">{msg}</span>}</div>
        </div>
      )}

      <b style={{ display: "block", marginTop: 10 }}>Sikhaye hue jawab ({kb.length})</b>
      {kb.length === 0 && <div className="small">Abhi koi nahi. Bina training ke AI catalog ki qeematon aur aam jawabon se draft banata hai.</div>}
      {kb.map((k) => (
        <div key={k.id} className="aiKbRow">
          <div style={{ flex: 1 }}>
            <div className="small"><b>{k.keywords}</b></div>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>{k.answer}</div>
          </div>
          {canEdit && <button className="btnSmall" onClick={() => { if (confirm("Ye jawab hata dein?")) save(kb.filter((x) => x.id !== k.id)); }}>Delete</button>}
        </div>
      ))}
    </div>
  );
}

export default function AiTrainingModal({ lines, onClose }: { lines?: ChatLine[]; onClose: () => void }) {
  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <div><b style={{ fontSize: 17 }}>📚 AI Reply Training</b><div className="small">AI ko apne jawab sikhayein — woh sirf draft banata hai, Send aap dabate hain.</div></div>
          <button className="btnSmall" onClick={onClose}>✕</button>
        </div>
        <AiKnowledge lines={lines} />
      </div>
    </div>
  );
}

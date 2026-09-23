import { useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

// The consultation ID is treated as a shared secret between the hospital
// and the patient (given to them by phone/WhatsApp — 4.4, 7), not
// something to leave sitting in plain view on a shared or screen-recorded
// device. Reveal-on-tap is a small, low-friction nod to that — the copy
// button only appears once the ID is visible, so copying never leaks it
// without the patient having chosen to look at it first.
export default function RevealId({ id, label = 'Consultation ID' }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — patient can still select/copy manually
      // once revealed.
    }
  }

  return (
    <div className="text-right text-xs text-[#5C6B72]">
      <p>{label}</p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="flex items-center justify-end gap-1.5 font-mono text-[#12242C] hover:text-[#0095D9]"
        >
          {visible ? id : '•••• •••••'}
          {visible ? (
            <EyeOff size={12} strokeWidth={2} />
          ) : (
            <Eye size={12} strokeWidth={2} />
          )}
        </button>
        {visible && (
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[#5C6B72] hover:text-[#0095D9]"
            aria-label={copied ? 'Copied' : `Copy ${label}`}
          >
            {copied ? (
              <Check size={12} strokeWidth={2} />
            ) : (
              <Copy size={12} strokeWidth={2} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
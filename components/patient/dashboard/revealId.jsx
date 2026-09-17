import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// The consultation ID is treated as a shared secret between the hospital
// and the patient (given to them by phone/WhatsApp — 4.4, 7), not
// something to leave sitting in plain view on a shared or screen-recorded
// device. Reveal-on-tap is a small, low-friction nod to that.
export default function RevealId({ id, label = 'Consultation ID' }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="text-right text-xs text-[#5C6B72]">
      <p>{label}</p>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="flex items-center justify-end gap-1.5 font-mono text-[#12242C] hover:text-[#0095D9]"
      >
        {visible ? id : '•••• •••••'}
        {visible ? <EyeOff size={12} strokeWidth={2} /> : <Eye size={12} strokeWidth={2} />}
      </button>
    </div>
  );
}
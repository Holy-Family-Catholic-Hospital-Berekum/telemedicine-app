import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Eraser } from "lucide-react";

// Draw-your-signature box (mouse, finger or pen). The drawing is exported
// as a small transparent PNG for the prescription form; the server checks
// its size (functions/lib/prescriptions.js signaturePng).
const WIDTH = 600;
const HEIGHT = 200;

const SignaturePad = forwardRef(function SignaturePad({ onChange }, ref) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  function point(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function start(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  }

  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = point(e);
    ctx.strokeStyle = "#0B1A40";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) {
      setHasInk(true);
      onChange?.(true);
    }
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    canvasRef.current.getContext("2d").clearRect(0, 0, WIDTH, HEIGHT);
    setHasInk(false);
    onChange?.(false);
  }

  useImperativeHandle(ref, () => ({
    clear,
    // PNG data: URL, or null if nothing was drawn.
    toPng: () => (hasInk ? canvasRef.current.toDataURL("image/png") : null),
  }));

  return (
    <div>
      <div className="relative rounded-md border border-[#C9D6DE] bg-white">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          aria-label="Signature drawing area"
          className="block h-36 w-full cursor-crosshair touch-none sm:h-40"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-[#C9D6DE]" />
        {!hasInk && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#9AA8AF]">
            Sign here
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={!hasInk}
        className="mt-2 inline-flex items-center gap-1.5 text-sm text-[#5C6B72] hover:text-[#12242C] disabled:opacity-40"
      >
        <Eraser size={14} /> Clear
      </button>
    </div>
  );
});

export default SignaturePad;

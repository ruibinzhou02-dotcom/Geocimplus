import React, { useState, useEffect } from "react";
import { boundedNumber } from "./numeric-input.mjs";
export default function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    if (text.trim() === "" || !Number.isFinite(Number(text))) {
      setText(String(value));
      return;
    }
    const v = boundedNumber(text, min, max, step);
    onChange(v);
    setText(String(v));
  };
  return (
    <label className="v2-number-slider">
      <span>{label}</span>
      <div>
        <input
          className="nodrag nowheel"
          type="range"
          aria-label={label + " slider"}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(+e.target.value)}
        />
        <input
          className="nodrag"
          aria-label={label + " value"}
          type="number"
          min={min}
          max={max}
          step={step}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (
              e.target.value !== "" &&
              Number.isFinite(v) &&
              v >= min &&
              v <= max
            )
              onChange(boundedNumber(v, min, max, step));
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      </div>
    </label>
  );
}

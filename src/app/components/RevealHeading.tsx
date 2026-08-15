"use client";

import { useEffect, useRef, useState } from "react";

export default function RevealHeading({
  children,
  as: Tag = "h2",
}: {
  children: string;
  as?: "h1" | "h2";
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [on, setOn] = useState(false);
  const words = children.split(" ");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setOn(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (entry.isIntersecting) setOn(true);
        });
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, []);

  return (
    <Tag ref={ref} className={on ? "reveal-on" : undefined}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="reveal-word" style={{ transitionDelay: `${i * 28}ms` }}>
          {word}
          {i < words.length - 1 ? "\u00a0" : ""}
        </span>
      ))}
    </Tag>
  );
}

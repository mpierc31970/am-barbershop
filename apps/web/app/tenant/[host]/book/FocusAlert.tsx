"use client";
// The /book error box: server-rendered (works without JS); with JS it takes focus so a
// screen reader and keyboard land on it after the redirect.
import { useEffect, useRef, type ReactNode } from "react";

export function FocusAlert({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <p
      ref={ref}
      id="book-error"
      role="alert"
      tabIndex={-1}
      className={className}
      data-book-error=""
    >
      {children}
    </p>
  );
}

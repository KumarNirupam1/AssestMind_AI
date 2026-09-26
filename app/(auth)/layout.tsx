import React from "react";

/** Centered layout wrapper for unauthenticated auth screens. */
const AuthLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <section className="flex min-h-svh flex-col items-center justify-center">
      <div className="w-full max-w-md">{children}</div>
    </section>
  );
};

export default AuthLayout;

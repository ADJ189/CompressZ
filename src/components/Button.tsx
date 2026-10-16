import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export type ButtonVariant = "solid" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Minimal button using the `pui-btn` styles. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "solid", size = "md", className, type = "button", ...rest },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "pui-btn",
        `pui-btn--${variant}`,
        size !== "md" && `pui-btn--${size}`,
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = "Button";

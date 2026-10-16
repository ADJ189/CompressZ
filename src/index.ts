/**
 * performative-ui, React components for the world's most performative
 * AI-startup landing page tropes. Tongue firmly in cheek.
 */

// Styles, imported here so consumers get them via `import 'performative-ui'`.
import "./styles.css";

// Primitives
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from "./components/Button";

// Interactions
export {
  SpotlightCard,
  type SpotlightCardProps,
} from "./components/SpotlightCard";
export { TiltCard, type TiltCardProps } from "./components/TiltCard";
export { Magnetic, type MagneticProps } from "./components/Magnetic";
export { CursorTrail, type CursorTrailProps } from "./components/CursorTrail";
export {
  ScrambleText,
  type ScrambleTextProps,
} from "./components/ScrambleText";
export {
  OversubscribedMeter,
  type OversubscribedMeterProps,
} from "./components/OversubscribedMeter";
export {
  CommandPalette,
  type CommandPaletteProps,
  type CommandItem,
} from "./components/CommandPalette";

// Social proof
export {
  LogoMarquee,
  type LogoMarqueeProps,
  type MarqueeItem,
} from "./components/LogoMarquee";

// Utilities
export { cn, type ClassValue } from "./utils/cn";

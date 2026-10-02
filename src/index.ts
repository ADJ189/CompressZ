/**
 * performative-ui, React components for the world's most performative
 * AI-startup landing page tropes. Tongue firmly in cheek.
 */

// Styles, imported here so consumers get them via `import 'performative-ui'`.
import "./styles.css";

// Atoms
export { Sparkle, type SparkleProps } from "./components/Sparkle";
export {
  GradientText,
  type GradientTextProps,
} from "./components/GradientText";
export { StatusDot, type StatusDotProps } from "./components/StatusDot";
export {
  QuestText,
  type QuestTextProps,
  type QuestTextAnimation,
  type QuestTextPreset,
  type QuestTextColor,
} from "./components/QuestText";

// Primitives
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from "./components/Button";
export {
  StickyBanner,
  type StickyBannerProps,
} from "./components/StickyBanner";
export { EyebrowPill, type EyebrowPillProps } from "./components/EyebrowPill";

// Heroes
export { Rotator, type RotatorProps } from "./components/Rotator";
export { WordRoll, type WordRollProps } from "./components/WordRoll";
export { PromptHero, type PromptHeroProps } from "./components/PromptHero";
export { Prompt, type PromptProps } from "./components/Prompt";
export { AsciiHero, type AsciiHeroProps } from "./components/AsciiHero";
export { Goldeneye, type GoldeneyeProps } from "./components/Goldeneye";

// Backgrounds
export { Aurora, type AuroraProps } from "./components/Aurora";
export {
  NodeGraphBackground,
  type NodeGraphBackgroundProps,
} from "./components/NodeGraphBackground";
export {
  FloatingSparkles,
  type FloatingSparklesProps,
} from "./components/FloatingSparkles";

// Surfaces
export { GlassCard, type GlassCardProps } from "./components/GlassCard";
export {
  MockIDE,
  type MockIDEProps,
  type IdeToken,
  type IdeTokenClass,
} from "./components/MockIDE";

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

// Conversation
export {
  ChatBubble,
  type ChatBubbleProps,
  type ChatRole,
} from "./components/ChatBubble";
export { TokenStream, type TokenStreamProps } from "./components/TokenStream";
export {
  WibblingSpinner,
  type WibblingSpinnerProps,
  DEFAULT_VERBS as WIBBLING_SPINNER_VERBS,
  DEFAULT_GLYPHS as WIBBLING_SPINNER_GLYPHS,
} from "./components/WibblingSpinner";
export { ChatFAB, type ChatFABProps } from "./components/ChatFAB";

// Social proof
export {
  LogoMarquee,
  type LogoMarqueeProps,
  type MarqueeItem,
} from "./components/LogoMarquee";
export {
  LogoRow,
  type LogoRowProps,
  type LogoRowItem,
} from "./components/LogoRow";
export {
  SlippyWords,
  type SlippyWordsProps,
  type SlippyWord,
} from "./components/SlippyWords";
export { StatCounter, type StatCounterProps } from "./components/StatCounter";
export {
  CommunityBadge,
  type CommunityBadgeProps,
} from "./components/CommunityBadge";

// Menus
export {
  Temperature,
  type TemperatureProps,
  type TemperatureOption,
  type TemperatureColor,
} from "./components/Temperature";

// Pricing / waitlist
export { PricingCard, type PricingCardProps } from "./components/PricingCard";
export { BeforeAfter, type BeforeAfterProps } from "./components/BeforeAfter";
export {
  WaitlistForm,
  type WaitlistFormProps,
} from "./components/WaitlistForm";
export { Popover, type PopoverProps } from "./components/Popover";

// Footers
export {
  BigBack,
  type BigBackProps,
  type BigBackColumn,
  type BigBackLink,
} from "./components/BigBack";

// Hooks (escape hatches for headless usage)
export {
  useTypewriter,
  type UseTypewriterOptions,
  type UseTypewriterResult,
} from "./hooks/useTypewriter";
export { useCounter, type UseCounterOptions } from "./hooks/useCounter";
export {
  useTokenStream,
  type UseTokenStreamOptions,
  type UseTokenStreamResult,
} from "./hooks/useTokenStream";
export {
  useAsciiField,
  type UseAsciiFieldOptions,
} from "./hooks/useAsciiField";

// Utilities
export { cn, type ClassValue } from "./utils/cn";

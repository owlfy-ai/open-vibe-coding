import type { IconName } from "../icons";
import { resolveLanguage, type UiLanguage } from "../i18n";

/**
 * Runtime-free marketing copy for the landing page.
 *
 * Intentionally separate from `presentation/i18n.ts` (which is close to the
 * 500-line presentation budget) and from `useT()` (which needs the application
 * runtime). The landing page renders before bootstrap, so it resolves language
 * from the system/agent locale only — no runtime, no Clerk, instant paint.
 */

export interface LandingFeature {
  readonly icon: IconName;
  readonly title: string;
  readonly desc: string;
}

export interface LandingStep {
  readonly title: string;
  readonly desc: string;
}

export interface LandingCopy {
  readonly nav: {
    readonly brand: string;
    readonly features: string;
    readonly howItWorks: string;
    readonly showcase: string;
    readonly startCta: string;
  };
  readonly hero: {
    readonly badge: string;
    readonly title: string;
    readonly subtitle: string;
    readonly primaryCta: string;
    readonly secondaryNote: string;
    readonly mockup: {
      readonly userMsg: string;
      readonly agentMsg: string;
      readonly url: string;
      readonly published: string;
      readonly score: string;
    };
  };
  readonly features: {
    readonly heading: string;
    readonly subheading: string;
    readonly items: readonly LandingFeature[];
  };
  readonly steps: {
    readonly heading: string;
    readonly subheading: string;
    readonly items: readonly LandingStep[];
  };
  readonly showcase: {
    readonly heading: string;
    readonly subheading: string;
    readonly prompts: readonly string[];
    readonly hint: string;
  };
  readonly cta: {
    readonly title: string;
    readonly subtitle: string;
    readonly button: string;
  };
  readonly footer: {
    readonly tagline: string;
    readonly rights: string;
  };
}

const zh: LandingCopy = {
  nav: {
    brand: "Open Vibe Coding",
    features: "功能",
    howItWorks: "怎么用",
    showcase: "灵感",
    startCta: "开始创作",
  },
  hero: {
    badge: "给每个人的 AI 创作伙伴",
    title: "说一句话，就能做出自己的网页应用",
    subtitle:
      "Open Vibe Coding 是一个懂你的 AI 创作伙伴。你用大白话描述点子，它帮你写代码、实时预览，还能一键发布链接，分享给朋友一起玩。",
    primaryCta: "开始创作",
    secondaryNote: "浏览器里直接运行 · 先体验，再登录",
    mockup: {
      userMsg: "做一个会跳的小恐龙游戏 🦖",
      agentMsg: "好呀！我加上了跳跃、仙人掌障碍和计分，点预览试试看。",
      url: "open-vibe-coding.app/dino",
      published: "已发布",
      score: "得分 0",
    },
  },
  features: {
    heading: "为什么大家都爱用",
    subheading: "从一句话到一个能玩的作品，全程都有 AI 陪你。",
    items: [
      {
        icon: "sparkles",
        title: "自然语言创作",
        desc: "不用写代码，用中文或英文说出想法，AI 帮你把它一步步做出来。",
      },
      {
        icon: "eye",
        title: "实时预览",
        desc: "边做边看，每改一处，预览立刻更新，所见即所得。",
      },
      {
        icon: "globe",
        title: "一键发布",
        desc: "完成后点一下，生成专属链接，分享给任何人都能打开。",
      },
      {
        icon: "image",
        title: "看图创作",
        desc: "上传一张截图、设计稿或手绘图，AI 也能照着做出来。",
      },
      {
        icon: "crosshair",
        title: "选中即改",
        desc: "在预览里点选任意元素，直接告诉 AI 想怎么改，精准又省事。",
      },
      {
        icon: "terminal",
        title: "自动修复",
        desc: "预览报错会自动反馈给 AI，它会自己查错、自己修，越改越稳。",
      },
    ],
  },
  steps: {
    heading: "三步，从点子到作品",
    subheading: "不用安装，不用配置，打开就能开始。",
    items: [
      {
        title: "说出你的点子",
        desc: "用一句话描述想做什么，比如「一个收集星星的小游戏」。",
      },
      {
        title: "看它一步步做出来",
        desc: "AI 编写文件、运行预览，你可以随时插话，提新的要求。",
      },
      {
        title: "发布并分享",
        desc: "满意后一键发布，把链接发给朋友，立刻就能一起玩。",
      },
    ],
  },
  showcase: {
    heading: "不知道做什么？试试这些",
    subheading: "把这些点子粘进对话框，看它变成真的应用。",
    prompts: [
      "做一个收集星星的小游戏",
      "做一个番茄钟，到点提醒我休息",
      "做一个记忆翻牌小游戏",
      "画一个会下彩虹雨的夜空",
      "做一个给宠物记体重的页面",
      "做一个倒计时惊喜盒子",
    ],
    hint: "点「开始创作」就能出发",
  },
  cta: {
    title: "你的第一个应用，从一句话开始",
    subtitle: "不用注册就能体验，点一下，看看 AI 能帮你做出什么。",
    button: "开始创作",
  },
  footer: {
    tagline: "让每个人都能创造。",
    rights: "© 2026 Open Vibe Coding",
  },
};

const en: LandingCopy = {
  nav: {
    brand: "Open Vibe Coding",
    features: "Features",
    howItWorks: "How it works",
    showcase: "Ideas",
    startCta: "Start creating",
  },
  hero: {
    badge: "An AI creative buddy for everyone",
    title: "Say it. Build a web app you can actually play.",
    subtitle:
      "Open Vibe Coding is an AI buddy that gets you. Describe an idea in plain words — it writes the code, previews it live, and publishes a link to share with friends.",
    primaryCta: "Start creating",
    secondaryNote: "Runs right in your browser · try it before you sign in",
    mockup: {
      userMsg: "Make a jumping dino game 🦖",
      agentMsg: "Sure! I added jumping, cactus obstacles and scoring. Try the preview.",
      url: "open-vibe-coding.app/dino",
      published: "Published",
      score: "Score 0",
    },
  },
  features: {
    heading: "Why people love it",
    subheading: "From one sentence to a playable creation, with AI by your side.",
    items: [
      {
        icon: "sparkles",
        title: "Create in natural language",
        desc: "No code needed. Describe your idea in words, and the AI builds it step by step.",
      },
      {
        icon: "eye",
        title: "Live preview",
        desc: "See it as you go — every change updates the preview instantly, WYSIWYG.",
      },
      {
        icon: "globe",
        title: "One-click publish",
        desc: "When it's ready, click once to get a link anyone can open.",
      },
      {
        icon: "image",
        title: "Create from images",
        desc: "Upload a screenshot, mockup or hand-drawn sketch and the AI builds from it.",
      },
      {
        icon: "crosshair",
        title: "Pick and edit",
        desc: "Select any element right in the preview and tell the AI how to change it.",
      },
      {
        icon: "terminal",
        title: "Self-healing",
        desc: "Preview errors flow back to the AI, which finds and fixes them on its own.",
      },
    ],
  },
  steps: {
    heading: "Three steps, idea to creation",
    subheading: "Nothing to install, nothing to configure. Open and start.",
    items: [
      {
        title: "Say your idea",
        desc: "Describe what you want in one line, like \"a star-collecting game.\"",
      },
      {
        title: "Watch it build",
        desc: "The AI writes files and runs the preview. Jump in with new asks anytime.",
      },
      {
        title: "Publish and share",
        desc: "When you love it, publish with one click and send the link to friends.",
      },
    ],
  },
  showcase: {
    heading: "Not sure what to make? Try these",
    subheading: "Paste a prompt into the chat and watch it become a real app.",
    prompts: [
      "Make a star-collecting game",
      "Make a pomodoro timer that reminds me to rest",
      "Make a memory matching game",
      "Draw a night sky with rainbow rain",
      "Make a page to track my pet's weight",
      "Make a countdown surprise box",
    ],
    hint: "Click \"Start creating\" to begin",
  },
  cta: {
    title: "Your first app starts with one sentence",
    subtitle: "No sign-up needed to try. Click once and see what the AI can build for you.",
    button: "Start creating",
  },
  footer: {
    tagline: "Let everyone create.",
    rights: "© 2026 Open Vibe Coding",
  },
};

export function landingCopy(language: UiLanguage): LandingCopy {
  return language === "zh" ? zh : en;
}

export function resolveLandingCopy(): LandingCopy {
  return landingCopy(resolveLanguage("system"));
}

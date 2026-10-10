export const LANGUAGES = {
  javascript: { label: 'JavaScript', extension: 'js', monaco: 'javascript' },
  python: { label: 'Python', extension: 'py', monaco: 'python' },
  cpp: { label: 'C++', extension: 'cpp', monaco: 'cpp' },
  java: { label: 'Java', extension: 'java', monaco: 'java' },
} as const;

export type Language = keyof typeof LANGUAGES;
export const LANGUAGE_IDS = Object.keys(LANGUAGES) as Language[];

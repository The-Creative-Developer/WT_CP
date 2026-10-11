import type { Language } from '@devverse/shared';

/** The file every new room starts with, so there is something to run straight away. */
export const STARTER_FILES: Record<Language, { path: string; content: string }> = {
  javascript: {
    path: 'main.js',
    content: `// Welcome to DevVerse! Everyone in this room sees your edits live.\nconsole.log('Hello from DevVerse!');\n`,
  },
  python: {
    path: 'main.py',
    content: `# Welcome to DevVerse! Everyone in this room sees your edits live.\nprint("Hello from DevVerse!")\n`,
  },
  cpp: {
    path: 'main.cpp',
    content: `// Welcome to DevVerse! Everyone in this room sees your edits live.\n#include <iostream>\n\nint main() {\n    std::cout << "Hello from DevVerse!" << std::endl;\n    return 0;\n}\n`,
  },
  java: {
    // Java requires the public class name to match the file name.
    path: 'Main.java',
    content: `// Welcome to DevVerse! Everyone in this room sees your edits live.\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from DevVerse!");\n    }\n}\n`,
  },
};

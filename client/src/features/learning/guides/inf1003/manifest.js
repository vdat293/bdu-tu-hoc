import { BAI_1_LESSON } from './bai-1.js';
import { BAI_1_MACOS_LESSON } from './bai-1-macos.js';

export { BAI_1_LESSON };

export const INF1003_GUIDES = [BAI_1_LESSON];
export const INF1003_MACOS_GUIDES = [BAI_1_MACOS_LESSON];

export const INF1003_STEP_ORDER = BAI_1_LESSON.steps.map((step) => step.id);

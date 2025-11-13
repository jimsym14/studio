'use server';

/**
 * @fileOverview An AI agent for triggering UI animations based on user interaction context.
 *
 * - triggerAnimation - A function that determines which animation to trigger.
 * - TriggerAnimationInput - The input type for the triggerAnimation function.
 * - TriggerAnimationOutput - The return type for the triggerAnimation function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const TriggerAnimationInputSchema = z.object({
  interactionType: z
    .string()
    .describe('The type of user interaction (e.g., button click, hover, screen transition).'),
  uiElement: z.string().describe('The UI element involved (e.g., button, modal, game tile).'),
  screenContext: z
    .string()
    .describe('The current screen or context within the application.'),
});
export type TriggerAnimationInput = z.infer<typeof TriggerAnimationInputSchema>;

const TriggerAnimationOutputSchema = z.object({
  animationName: z.string().describe('The name of the animation to trigger (e.g., scaleUp, fadeIn, tileFlip).'),
  animationDuration: z
    .string()
    .optional()
    .describe('The duration of the animation in seconds or milliseconds (e.g., 0.2s, 500ms).'),
  easingFunction: z
    .string()
    .optional()
    .describe('The easing function to use for the animation (e.g., ease-in-out, spring).'),
  additionalParams: z
    .record(z.any())
    .optional()
    .describe('Additional parameters to pass to the animation function.'),
});
export type TriggerAnimationOutput = z.infer<typeof TriggerAnimationOutputSchema>;

export async function triggerAnimation(input: TriggerAnimationInput): Promise<TriggerAnimationOutput> {
  return triggerAnimationFlow(input);
}

const triggerAnimationPrompt = ai.definePrompt({
  name: 'triggerAnimationPrompt',
  input: {schema: TriggerAnimationInputSchema},
  output: {schema: TriggerAnimationOutputSchema},
  prompt: `You are an expert UI/UX designer specializing in creating delightful user experiences through animations.

You will be provided with the type of user interaction, the UI element involved, and the current screen context.
Based on this information, you will determine the most appropriate animation to trigger to enhance the user experience.

Consider the following animation principles:
- Provide clear visual feedback for user actions.
- Use subtle animations to avoid overwhelming the user.
- Ensure animations are performant and do not cause lag.
- Use a consistent animation style throughout the application.

Interaction Type: {{{interactionType}}}
UI Element: {{{uiElement}}}
Screen Context: {{{screenContext}}}

Based on this context, suggest an animation to use. Return the animation name, duration, easing function, and any additional parameters needed.
`,
});

const triggerAnimationFlow = ai.defineFlow(
  {
    name: 'triggerAnimationFlow',
    inputSchema: TriggerAnimationInputSchema,
    outputSchema: TriggerAnimationOutputSchema,
  },
  async input => {
    const {output} = await triggerAnimationPrompt(input);
    return output!;
  }
);

# **App Name**: WordMates

## Core Features:

- Anonymous Authentication: Authenticate users anonymously using Firebase to assign a persistent userId upon app load.
- Persistent Lobby Creation: Create a new game document in Firestore when a user starts a multiplayer game. This includes storing game settings, status ('waiting'), and the creator's userId.
- Invite Link Sharing: Generate and display a persistent invite link for the lobby, allowing players to join via the link even if the creator closes the browser.
- Real-Time Game Synchronization: Implement real-time synchronization using Firestore's onSnapshot() to update the game state across all connected players.
- User Preference Persistence: Persist user preferences (language, theme) using localStorage and apply these settings on app load.
- Animated UI/UX: Implement UI animations, including button hover effects, modal transitions, screen navigations, and tile flip animations using framer-motion. This feature will use 'tool' logic to decide which animation to trigger, using LLM reasoning.
- Responsive Design: Ensure the UI is fully responsive and mobile-first, scaling cleanly to desktop screens.

## Style Guidelines:

- Primary color: Deep sky blue (#42A5F5) for a clean and modern feel.
- Background color: Very light blue (#E3F2FD) for a calm, unobtrusive background.
- Accent color: Cyan (#00BCD4) for interactive elements and highlights, creating visual interest without overwhelming the user.
- Body and headline font: 'Inter', a sans-serif font providing a modern and neutral aesthetic, ensuring readability and a clean interface.
- Use high-quality SVG icons for all interactive elements (buttons, toggles, settings) to enhance usability and visual appeal.
- Implement a minimalist and uncluttered layout, focusing on a mobile-first design that scales up to desktop, ensuring a fast and app-like experience.
- Use framer-motion for subtle animations, including button hover effects, modal transitions, screen navigations, and tile flip animations, to enhance user experience and provide visual feedback.
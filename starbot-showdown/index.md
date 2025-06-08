---
title: "Starbot Showdown"
company: "Student project"
year: "2020"
platform: "itch.io"

description: "Battle it out with up to three friends and a variety of food-based explosives to find out whose cuisine-bot ranks supreme-bot."
download: "[{{PLATFORM}} - free download](https://gmugame410-001.itch.io/starbot-showdown)"

buttons:
  - "Lead Programmer"
  - "Gameplay Programmer"
  - "Bomb Programmer"
  - "AI Programmer"
---

{{ABOUT}}

Starbot Showdown was made by 32 students for use with the Winnitron arcade game platform at George Mason University in the Spring of 2020.

### Extensible Explosives

A wide variety of explosive foodstuffs are at players' disposal. I created an inheritable base class for bombs that contained reusable functionality, enabling developers to easily expand bomb types as designers envisioned them.

![Extensible Explosives](media/videos/Bombs.webm)

### Implementing Input

Although it was still in a pre-release state at the time, I quickly learned how to use Unity's more modular Input System, implementing it to simplify the process of handling separate players' inputs down to the usage of a single function for each input.

The pre-release state of the system meant I had to figure out some workarounds to allow for multiple players to share a keyboard, but the simplicity and modularity the system offered allowed me to get a functional prototype of the game built in only a couple days.

![Implementing Input](media/videos/Input.webm)

### Frenzy Mode

The wave-based Frenzy mode offers players a means of playing alone, but can be played cooperatively with others, as well.

Players must defend the base in the center from enemy starbots with various types of behaviors - some try to bomb the base, some shoot burrito torpedos at players, but all share a base class for their AI that made implementing new enemy behaviors a straightforward process.

Originally, the only singleplayer content available would have been a 15-stage tutorial of the game's bombs and mechanics, but I discussed with the design team how to reasonably offer more for singleplayer play without drastically increasing the scope of the project. This led to the creation of this mode, which retooled the tutorial's enemies to offer more fun for those playing alone.

![Frenzy Mode](media/videos/Frenzy.webm)

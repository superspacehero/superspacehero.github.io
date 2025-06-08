var lastSoundPlayed = 0;
var sounds = document.getElementsByTagName('audio');

function pseudoData() {
    // Generate between 2 and 4 random characters
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var randomChars = '';
    var numChars = Math.floor(Math.random() * 3) + 2; // Random number between 2 and 4
    for (var i = 0; i < numChars; i++) {
        randomChars += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return randomChars;
}

function playsound() {
    // Get a random sound from the array
    var sound = lastSoundPlayed;
    if (sounds.length > 1) {
        while (sound == lastSoundPlayed)
        {
            sound = Math.floor(Math.random() * (sounds.length));
        }
        lastSoundPlayed = sound;
    }
    sound = sounds[sound];

    sound.autoplay = 'true';
    sound.load();
}
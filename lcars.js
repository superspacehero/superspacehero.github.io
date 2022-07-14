// document.addEventListener("touchstart", function() {},false);

// $(window).scroll(function() {
//     var height = $(window).scrollTop();
//     if (height > 100) {
//         $('.scroll-top a').fadeIn();
//     } else {
//         $('.scroll-top a').fadeOut();
//     }
// });

// $(document).ready(function() {
//     $("#scroll-top").click(function(event) {
//         event.preventDefault();
//         $("html, body").animate({ scrollTop: 0 }, "slow");
//         return false;
//     });

// });

var lastSoundPlayed = 0;
var sounds = document.getElementsByTagName('audio');

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
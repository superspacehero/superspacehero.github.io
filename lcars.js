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

var audios = [
    'media/sounds/Alarm.ogg',
    'media/sounds/Alarm2.ogg',
    'media/sounds/BuzzWarmUp.ogg',
    'media/sounds/DigitalSeal.ogg',
    'media/sounds/GroanDown.ogg',
    'media/sounds/GroanUp.ogg',
    'media/sounds/SelectionSound.ogg',
    'media/sounds/ZapDown.ogg'
];

var lastSoundPlayed = 0;

function playsound() {

    // Get a random sound from the array
    var audio = lastSoundPlayed;

    if (audios.length > 1) {
        while (audio == lastSoundPlayed)
        {
            audio = Math.floor(Math.random() * (audios.length));
        }
        lastSoundPlayed = audio;
    }

    audio = audios[audio];

    // Change mysound.src to the path of the sound file you want to play
    mysound.src = audio;
    mysound.autoplay = 'true';
    mysound.load();
}
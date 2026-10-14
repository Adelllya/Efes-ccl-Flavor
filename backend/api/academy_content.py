"""
Стартовое содержимое Академии: уроки четырёх ступеней и дополнительные вопросы теста.

Уроки составлены по открытым материалам Cicerone Certification Program (программа Certified
Beer Server) и руководству по стилям BJCP. Это учебный материал, а не профессиональная сертификация.

Модели передаются снаружи: одни и те же функции вызывают миграция (исторические модели),
команда load_academy и страница Академии, если таблица уроков пуста.
"""

# Блоки урока: text, facts, steps, tip, check (вопрос для самопроверки), practice (переход в раздел сайта).
LESSONS = [
    # Ступень 1. Новичок
    {
        'level': 1, 'slug': 'ingredients', 'minutes': 3,
        'title': 'What beer is made of',
        'summary': 'Water, malt, hops and yeast: which part of the flavor each one is responsible for.',
        'blocks': [
            {'type': 'text', 'text': 'Classic beer has four ingredients. Each one is responsible for its own part of the flavor, '
                                     'and once you know who does what, you can easily break down the taste of any beer.'},
            {'type': 'facts', 'title': 'Who does what', 'items': [
                'Water: more than 90% of the drink. Soft water makes the taste rounder, hard water emphasizes bitterness.',
                'Malt: sprouted and dried grain, usually barley. It gives color, body and sweetness: bread, biscuit, caramel.',
                'Hops: the cones of a climbing plant. They give bitterness and aroma: herbs, flowers, citrus, pine.',
                'Yeast: turns malt sugar into alcohol and carbon dioxide. It adds fruity and spicy notes.',
            ]},
            {'type': 'tip', 'text': 'Easy to remember: malt is sweetness and color, hops are bitterness and aroma, yeast is character.'},
            {'type': 'check', 'question': 'The beer is dark, with caramel notes. Which ingredient is responsible for that?',
             'options': ['Hops', 'Malt', 'Water', 'Yeast'], 'correct_index': 1,
             'explanation': 'Color and caramel notes come from malt: the darker it is roasted, the darker the beer.'},
            {'type': 'practice', 'text': 'Open any beer in the catalog and find the malt and hop notes in its pyramid.',
             'action': 'explorer', 'label': 'Open catalog'},
        ],
    },
    {
        'level': 1, 'slug': 'lager-and-ale', 'minutes': 3,
        'title': 'Lager and ale',
        'summary': 'The two big families of beer and how they really differ.',
        'blocks': [
            {'type': 'text', 'text': 'All beers fall into two big families. The difference is not color or strength, '
                                     'but the yeast and the fermentation temperature.'},
            {'type': 'facts', 'title': 'Two families', 'items': [
                'Lager: the yeast works cold, at 7-13 °C, and settles to the bottom. The taste is clean and even, with malt and hops up front.',
                'Ale: the yeast works warm, at 15-24 °C, and rises to the top. It gives fruity and spicy notes.',
                'Color and strength can be anything in both families: there are dark lagers and pale ales.',
            ]},
            {'type': 'text', 'text': 'Almost all mainstream beers in Kazakhstan are lagers: pilsner, pale lager and Czech lager. '
                                     'That is why the nuances of malt and hops matter so much in them.'},
            {'type': 'check', 'question': 'A guest asks for "something with a clean taste, without fruity notes". What fits better?',
             'options': ['Lager', 'Ale', 'No difference'], 'correct_index': 0,
             'explanation': 'Cold lager fermentation produces no fruity esters, so the taste stays clean.'},
        ],
    },
    {
        'level': 1, 'slug': 'read-the-label', 'minutes': 3,
        'title': 'How to read a label',
        'summary': 'Three numbers that let you imagine the taste before the first sip.',
        'blocks': [
            {'type': 'text', 'text': 'The label and the beer description contain three numbers that let you imagine the taste '
                                     'before the first sip.'},
            {'type': 'facts', 'title': 'Three numbers', 'items': [
                'Alcohol (ABV): alcohol by volume. Light beers are 4-5%, strong ones 6% and above.',
                'Gravity, or original wort extract: how much malt material was in the wort before fermentation. The higher it is, the fuller the body.',
                'Bitterness (IBU): International Bitterness Units. A light lager has about 8-20, a pilsner 25-45.',
            ]},
            {'type': 'facts', 'title': 'Also worth checking', 'items': [
                'Bottling date and best-before date: the fresher a pale beer, the brighter the hops.',
                'Storage conditions: cool and dark. Light and heat quickly spoil the taste.',
                'Ingredients: malt, hops, water, sometimes rice or corn for a lighter body.',
            ]},
            {'type': 'tip', 'text': 'Strength and bitterness are not the same thing. A strong beer can be smooth, and a light one noticeably bitter.'},
            {'type': 'check', 'question': 'The label says "gravity 12%, alc. 4.8%". What does the first number mean?',
             'options': ['The alcohol content', 'How much malt material was in the wort before fermentation', 'Bitterness', 'The share of hops'],
             'correct_index': 1,
             'explanation': 'Gravity tells you about the body of the beer. Alcohol is listed separately.'},
        ],
    },

    # Ступень 2. Исследователь
    {
        'level': 2, 'slug': 'flavor-pyramid', 'minutes': 3,
        'title': 'The flavor pyramid',
        'summary': 'Flavor unfolds in three layers: top, heart and base.',
        'blocks': [
            {'type': 'text', 'text': 'The taste of beer does not open up all at once, but in layers, like the scent of a perfume. '
                                     'In Flavor Tree every beer is broken down into three layers.'},
            {'type': 'steps', 'title': 'Three layers', 'items': [
                {'title': 'Top (TOP)', 'text': 'The aroma and the first seconds of the sip. What you sense with your nose and right away on the tongue.'},
                {'title': 'Heart (HEART)', 'text': 'The body of the flavor, from the third to the fifteenth second. This is where you notice the malt and the main character of the beer.'},
                {'title': 'Base (BASE)', 'text': 'The aftertaste: what stays after the sip. Most often it is hop bitterness, dryness or sweetness.'},
            ]},
            {'type': 'tip', 'text': 'Note intensity in the pyramid is shown from 1 to 10. Notes rated 7 and above you will '
                                    'almost certainly notice, notes rated 3-4 you will have to look for.'},
            {'type': 'check', 'question': 'You take a sip and after ten seconds you sense a bready sweetness. Which layer is it?',
             'options': ['Top', 'Heart', 'Base'], 'correct_index': 1,
             'explanation': 'From the third to the fifteenth second the heart opens up: body and malt.'},
            {'type': 'practice', 'text': 'Open the pyramid of any beer and find the brightest note in each layer.',
             'action': 'explorer', 'label': 'Open catalog'},
        ],
    },
    {
        'level': 2, 'slug': 'tasting-steps', 'minutes': 4,
        'title': 'Tasting in four steps',
        'summary': 'Look, smell, taste, listen to the aftertaste.',
        'blocks': [
            {'type': 'text', 'text': 'Tasting is simply an attentive sip. The four steps take a minute '
                                     'and help you notice what usually slips by.'},
            {'type': 'steps', 'title': 'Four steps', 'items': [
                {'title': 'Look', 'text': 'Color, clarity, foam. A dense, lasting head means freshness and a clean glass.'},
                {'title': 'Smell', 'text': 'Gently swirl the glass and take two or three short sniffs. This releases the aromas.'},
                {'title': 'Taste', 'text': 'A small sip, let the beer cover the whole tongue. Breathe out through your nose: the aroma comes back once more.'},
                {'title': 'Listen to the aftertaste', 'text': 'What remains after a few seconds: bitterness, dryness, sweetness? How long does it last?'},
            ]},
            {'type': 'facts', 'title': 'What gets in the way', 'items': [
                'Ice-cold beer: cold dulls the receptors. For tasting, 6-10 °C is better.',
                'Strong smells nearby: perfume, spicy food.',
                'A dirty or warm glass.',
            ]},
            {'type': 'check', 'question': 'Why breathe out through your nose after a sip?',
             'options': ['To cool your mouth faster', 'The aroma reaches the receptors from the inside, and the taste comes through more fully', 'To get rid of bitterness'],
             'correct_index': 1,
             'explanation': 'This is retronasal aroma: most of what we call "taste" is actually smell.'},
            {'type': 'practice', 'text': 'Taste a beer step by step and mark in your taste passport which notes you noticed.',
             'action': 'explorer', 'label': 'Choose a beer'},
        ],
    },
    {
        'level': 2, 'slug': 'where-notes-come-from', 'minutes': 4,
        'title': 'Where notes come from',
        'summary': 'Malt, hop and yeast notes, plus signs of off-flavors.',
        'blocks': [
            {'type': 'text', 'text': 'If you know where a note comes from, it is easier to recognize and name it.'},
            {'type': 'facts', 'title': 'Malt', 'items': [
                'Pale malt: bread, crackers, honey.',
                'Caramel malt: caramel, toffee, dried fruit.',
                'Roasted malt: coffee, chocolate, toasted crust.',
            ]},
            {'type': 'facts', 'title': 'Hops', 'items': [
                'European: herbs, flowers, spices.',
                'American and New Zealand: citrus, pine, tropical fruit.',
                'Bitterness in the aftertaste also comes from hops.',
            ]},
            {'type': 'facts', 'title': 'Yeast', 'items': [
                'Lager yeast: almost neutral, the taste is clean.',
                'Wheat yeast: banana and clove.',
                'Belgian yeast: pepper, pear, spices.',
            ]},
            {'type': 'facts', 'title': 'When something is wrong', 'items': [
                'Cooked corn: a brewing defect (DMS).',
                'Butter, butterscotch: diacetyl. In small amounts it is acceptable in some Czech lagers, in others it is a defect.',
                'Wet cardboard: the beer has oxidized, it is old or was stored warm.',
                'A sharp unpleasant smell after sunlight: the beer is "light-struck".',
            ]},
            {'type': 'check', 'question': 'In a pale lager you notice flowers and herbs. Where do they come from?',
             'options': ['From the malt', 'From European hops', 'From the yeast'], 'correct_index': 1,
             'explanation': 'Herbal and floral notes are the signature of classic European hops.'},
        ],
    },

    # Ступень 3. Знаток
    {
        'level': 3, 'slug': 'pairing-principles', 'minutes': 4,
        'title': 'Four pairing principles',
        'summary': 'Complement, contrast, cleanse, bridge: how a sommelier pairs beer with food.',
        'blocks': [
            {'type': 'text', 'text': 'A good pairing is when the dish and the beer taste better together than apart. '
                                     'Sommeliers use four principles. In Flavor Tree every pairing shows its principle.'},
            {'type': 'steps', 'title': 'Principles', 'items': [
                {'title': 'Complement', 'text': 'Similar flavors amplify each other. Caramel malt next to a golden crust on meat.'},
                {'title': 'Contrast', 'text': 'Opposites balance each other. Light malt sweetness softens spicy food, bitterness offsets sweetness.'},
                {'title': 'Cleanse', 'text': 'Carbonation and bitterness wash away fat and salt. The next bite is vivid again.'},
                {'title': 'Bridge', 'text': 'The dish and the beer share a note that connects them: smoke, roast, herbs, citrus.'},
            ]},
            {'type': 'tip', 'text': 'Compare intensity first. A light dish with a light beer, a rich dish with a full-bodied one: '
                                    'otherwise one of the two gets lost.'},
            {'type': 'check', 'question': 'A fresh, fizzy pilsner is served with a fatty fried dish. Which principle is at work?',
             'options': ['Complement', 'Cleanse', 'Bridge'], 'correct_index': 1,
             'explanation': 'Carbonation and hop bitterness cut through the fat.'},
            {'type': 'practice', 'text': 'Enter any dish and see which principle the pairing suggests.',
             'action': 'landing', 'label': 'Find a pairing'},
        ],
    },
    {
        'level': 3, 'slug': 'kazakh-cuisine', 'minutes': 4,
        'title': 'Beer and Kazakh cuisine',
        'summary': 'Beshbarmak, kazy, shashlik, baursaks: how to think about a pairing.',
        'blocks': [
            {'type': 'text', 'text': 'Kazakh cuisine is meat, dough, fat and salt. That makes it an easy partner for beer: '
                                     'almost every dish has something to cleanse or something to support.'},
            {'type': 'facts', 'title': 'How to think about it', 'items': [
                'Beshbarmak: boiled meat, dough, broth. A heavy dish that needs a beer with body and good carbonation.',
                'Kazy and shuzhuk: fat and salt. They call for hop bitterness and carbonation to cleanse the palate.',
                'Shashlik and grilled meat: roast and smoke. Beers with caramel malt are a natural match.',
                'Baursaks and samsa: fried and baked dough. A light, fresh lager works well.',
                'Manty and plov: fat, onion, spices. You need a beer that refreshes between bites.',
                'Kurt and salty snacks: salt makes you thirsty, a light lager gets along with it.',
            ]},
            {'type': 'tip', 'text': 'A spicy dish plus a strong bitter beer is a bad idea: alcohol and bitterness intensify the burn.'},
            {'type': 'check', 'question': 'A guest ordered kazy. What matters most in the beer?',
             'options': ['Sweetness', 'Bitterness and carbonation to cut the fat', 'Dark color'], 'correct_index': 1,
             'explanation': 'Fatty and salty food calls for freshness: bitterness and carbonation cleanse the palate.'},
            {'type': 'practice', 'text': 'See the pairings for Kazakh dishes chosen by the sommelier.',
             'action': 'pairing', 'label': 'Open pairings'},
        ],
    },
    {
        'level': 3, 'slug': 'serving', 'minutes': 4,
        'title': 'Serving: temperature, glass, foam',
        'summary': 'Why the same beer can taste boring or excellent.',
        'blocks': [
            {'type': 'text', 'text': 'The same beer can seem boring or excellent. Often the only difference is how it is served.'},
            {'type': 'facts', 'title': 'Temperature', 'items': [
                'Pale lagers, pilsners, wheat beers: 4-7 °C.',
                'Amber and dark lagers, ales: 7-10 °C.',
                'Strong and full-bodied beers: 10-13 °C.',
                'Beer that is too cold loses its aroma, beer that is too warm feels flat and heavy.',
            ]},
            {'type': 'steps', 'title': 'Pouring', 'items': [
                {'title': 'A clean glass', 'text': 'Rinse it with cold water: this washes away dust and detergent residue.'},
                {'title': '45° angle', 'text': 'Pour down the side, and straighten the glass halfway through.'},
                {'title': 'A head of foam', 'text': 'About two fingers. The foam holds the aroma and protects the beer from air.'},
            ]},
            {'type': 'facts', 'title': 'Storage', 'items': [
                'Cold and dark.',
                'Bottles upright, so the sediment stays at the bottom.',
                'Draft beer does not last long after the keg is tapped: watch the date.',
            ]},
            {'type': 'check', 'question': 'After each sip the foam leaves even rings on the sides of the glass. What does that tell you?',
             'options': ['The beer has gone flat', 'The glass is clean', 'The beer is too warm'], 'correct_index': 1,
             'explanation': 'Even "lacing" on the sides is a sign of clean glass.'},
            {'type': 'practice', 'text': 'Every beer card shows the serving temperature and the glass.',
             'action': 'explorer', 'label': 'Open catalog'},
        ],
    },

    # Ступень 4. Сомелье
    {
        'level': 4, 'slug': 'guest-talk', 'minutes': 4,
        'title': 'Talking to a guest',
        'summary': 'Three questions that point to the right choice in half a minute.',
        'blocks': [
            {'type': 'text', 'text': 'A guest does not have to know about beer. The job of the sommelier and the waiter is to understand in half a minute '
                                     'what they will like and explain the choice in simple words.'},
            {'type': 'steps', 'title': 'Three questions', 'items': [
                {'title': 'What will you be eating?', 'text': 'The dish gives you half the answer.'},
                {'title': 'Lighter or fuller?', 'text': 'This is how you choose between a fresh light beer and one with body.'},
                {'title': 'A bit bitter or smoother?', 'text': 'Bitterness is the most common reason to say no, so it is better to ask up front.'},
            ]},
            {'type': 'facts', 'title': 'How to answer', 'items': [
                'Offer one or two options: a familiar one and one "a step bolder".',
                'Talk in familiar terms: bread, honey, caramel, citrus. Leave the jargon to your colleagues.',
                'Give a reason: "with your dish, because...".',
                'Do not push. The guest is free to choose their own.',
            ]},
            {'type': 'tip', 'text': 'If the guest is driving or does not drink alcohol, offer a non-alcoholic drink. Alcohol is not sold '
                                    'to guests under 21: if in doubt, ask for ID.'},
            {'type': 'check', 'question': 'A guest says: "I\'d like something not bitter". What is your next step?',
             'options': ['Bring the lightest beer without asking',
                         'Ask what they will be eating and offer one or two smooth beers',
                         'Explain what IBU is'],
             'correct_index': 1,
             'explanation': 'The dish plus one clarifying question gives an accurate recommendation.'},
        ],
    },
    {
        'level': 4, 'slug': 'waiter-formula', 'minutes': 3,
        'title': 'A pairing in 15 seconds: the waiter\'s formula',
        'summary': 'Dish, beer and reason in one sentence.',
        'blocks': [
            {'type': 'text', 'text': 'People listen to a recommendation when it is short and has a reason. A three-part formula fits into one sentence.'},
            {'type': 'steps', 'title': 'The formula', 'items': [
                {'title': 'Dish', 'text': '"With your beshbarmak..."'},
                {'title': 'Beer', 'text': '"...try the Czech lager..."'},
                {'title': 'Reason', 'text': '"...its caramel malt picks up the flavor of the meat, and the carbonation refreshes."'},
            ]},
            {'type': 'facts', 'title': 'When and how to suggest', 'items': [
                'When the dish is ordered, not after.',
                'One suggestion, not three.',
                'Don\'t know the beer? Open the Flavor Tree menu: the pairing and the reason are shown next to the dish.',
                'Draft beer is a good first suggestion: it is fresher and leaves less packaging behind.',
            ]},
            {'type': 'tip', 'text': 'An honest recommendation works better than a pushy one: a guest who liked the pairing '
                                    'will come back and ask for advice again.'},
            {'type': 'check', 'question': 'Which phrase works better?',
             'options': ['"Take this one, everyone does"',
                         '"This lager goes well with your shashlik: the caramel malt supports the crust"',
                         '"We have lots of beers, take your pick"'],
             'correct_index': 1,
             'explanation': 'Dish, beer and reason in one sentence.'},
            {'type': 'practice', 'text': 'Open the venue menu and see how the pairing is shown next to the dish.',
             'action': 'menu', 'label': 'Open menu'},
        ],
    },
    {
        'level': 4, 'slug': 'service-problems', 'minutes': 4,
        'title': 'When something is wrong with the beer',
        'summary': 'Signs of off-flavors and what to do when a guest sends a glass back.',
        'blocks': [
            {'type': 'text', 'text': 'A faulty drink is not the guest\'s fault and not a reason to argue. What matters is to find the cause quickly and fix it.'},
            {'type': 'facts', 'title': 'Signs and causes', 'items': [
                'Wet cardboard smell, dull taste: the beer has oxidized. Check the batch date and storage conditions.',
                'A sharp "skunky" smell: the beer was left in the light.',
                'Butter or sourness in draft beer: the lines are dirty. They are cleaned about once every two weeks.',
                'Too much foam when pouring: the beer is warm or the pressure is wrong.',
                'Foam disappears immediately: grease or detergent is left on the glass.',
            ]},
            {'type': 'steps', 'title': 'What to do', 'items': [
                {'title': 'Apologize and replace the drink', 'text': 'No arguing and no explaining that "it is supposed to be like that".'},
                {'title': 'Tell the manager', 'text': 'The keg or batch needs to be checked before the defect reaches other guests.'},
                {'title': 'Write it down', 'text': 'Date, beer, what exactly was wrong.'},
            ]},
            {'type': 'check', 'question': 'Draft beer has suddenly turned sourish. What is the likely cause?',
             'options': ['That is just the style', 'Dirty draft lines', 'The glass is too cold'], 'correct_index': 1,
             'explanation': 'A sour or buttery note in draft beer most often comes from a dirty line.'},
        ],
    },
]

# Дополнительные вопросы теста: по 8 на ступень. Вместе со стартовыми 20 получается 52,
# и каждый тест собирается из случайных вопросов ступени.
# (ступень, вопрос, варианты, номер верного, пояснение)
EXTRA_QUESTIONS = [
    (1, 'Which ingredient gives beer its color and its bready, caramel notes?',
     ['Hops', 'Malt', 'Yeast', 'Water'],
     1, 'Malt is sprouted and dried grain. The darker it is roasted, the darker the beer.'),
    (1, 'What does yeast do?',
     ['Turns sugar into alcohol and carbon dioxide', 'Gives bitterness', 'Colors the beer', 'Makes the beer clear'],
     0, 'Yeast eats the malt sugar and releases alcohol and gas, adding fruity and spicy notes along the way.'),
    (1, 'What is measured in IBU?',
     ['Strength', 'Bitterness', 'Color', 'Gravity'],
     1, 'IBU are International Bitterness Units. A light lager has about 8-20, a pilsner 25-45.'),
    (1, 'The label says "gravity 11%". What does that mean?',
     ['The alcohol content', 'How much malt material was in the wort before fermentation', 'The share of hops', 'Calories'],
     1, 'This is the original wort extract. The higher it is, the fuller the body and usually the higher the strength.'),
    (1, 'What is beer more than 90% made of?',
     ['Water', 'Malt', 'Hops', 'Alcohol'],
     0, 'Water is the base of the drink. Its hardness noticeably affects the taste.'),
    (1, 'Where is the best place to keep beer at home?',
     ['On a sunny windowsill', 'In the fridge or a dark, cool place', 'Next to a radiator', 'In the freezer'],
     1, 'Light and heat quickly spoil the taste. The freezer is no good either: the beer will freeze and lose its fizz.'),
    (1, 'Which gas makes beer fizzy?',
     ['Oxygen', 'Carbon dioxide', 'Hydrogen', 'Helium'],
     1, 'Carbon dioxide is released by yeast during fermentation. Oxygen, on the contrary, is bad for beer: it oxidizes it.'),
    (1, 'From what age is it legal to sell alcohol, including beer, in Kazakhstan?',
     ['From 16', 'From 18', 'From 21', 'From 25'],
     2, 'In Kazakhstan alcohol is sold only to people aged 21 and over. The seller has the right to ask for ID.'),

    (2, 'In what order does the flavor pyramid unfold?',
     ['Base, heart, top', 'Top, heart, base', 'Heart, top, base', 'All layers at once'],
     1, 'First the aroma and the first seconds, then the body of the flavor, and finally the aftertaste.'),
    (2, 'What is retronasal aroma?',
     ['The smell from the glass before the sip', 'The aroma you sense when breathing out through your nose after a sip',
      'The smell of the cork', 'The aroma of malt during brewing'],
     1, 'After a sip, aromatic compounds rise to the receptors from the inside. That is why tasters breathe out through the nose.'),
    (2, 'The beer smells of butter or butterscotch. What compound is that?',
     ['Diacetyl', 'DMS', 'Hop oil', 'Tannin'],
     0, 'In small amounts diacetyl is acceptable in some Czech lagers, in other lagers it is a defect.'),
    (2, 'What affects the color of beer the most?',
     ['How much the malt is roasted', 'The amount of hops', 'Fermentation time', 'Water hardness'],
     0, 'Pale malt gives a golden color, caramel malt amber, roasted malt dark.'),
    (2, 'Why gently swirl the glass before tasting?',
     ['To let all the gas out', 'To release the aromas', 'To cool the beer', 'To let the foam settle'],
     1, 'The movement helps aromatic compounds rise from the beer.'),
    (2, 'What is the "body" of a beer?',
     ['Its color against the light', 'The feeling of density and fullness in the mouth', 'The height of the foam', 'The level of carbonation'],
     1, 'A light body feels like water, a full one feels dense and rounded.'),
    (2, 'Why does very cold beer seem less aromatic?',
     ['Cold dulls the receptors and keeps the aromas in the drink', 'Cold beer has less alcohol',
      'Cold destroys the hops', 'It is a myth, there is no difference'],
     0, 'That is why beer for tasting is served a little warmer than for regular serving.'),
    (2, 'Which notes does caramel malt give?',
     ['Grapefruit and pine', 'Caramel, toffee, dried fruit', 'Banana and clove', 'Pepper and pear'],
     1, 'Citrus and pine come from hops, banana and clove from wheat yeast.'),

    (3, 'The main rule of pairing by "weight":',
     ['A light beer with a heavy dish', 'The intensity of the beer and the dish should be similar',
      'Dark beer only with desserts', 'Strong beer goes with everything'],
     1, 'If one of the two is noticeably more intense, the other gets lost.'),
    (3, 'What helps "wash away" the fattiness of a dish?',
     ['Sweetness', 'Carbonation and bitterness', 'A high beer temperature', 'Thick foam'],
     1, 'Carbonation and hop bitterness cleanse the receptors of fat.'),
    (3, 'Why do the crust of fried meat and caramel malt go well together?',
     ['Both have similar toasty notes', 'The meat boosts bitterness', 'Malt is neutral',
      'They contrast in acidity'],
     0, 'Both the crust and caramel malt are produced by heat: they share notes. This is the "Bridge" or "Complement" principle.'),
    (3, 'With salty snacks (kurt, cheese, nuts) it makes more sense to offer...',
     ['A light, refreshing lager', 'A very strong sweet beer', 'Warm beer', 'The most bitter beer'],
     0, 'Salt makes you thirsty. A fresh lager refreshes and does not compete with the snack.'),
    (3, 'Why is the glass rinsed with cold water before pouring?',
     ['To dilute the beer', 'To wash away dust and detergent residue: the foam forms more evenly',
      'To make the beer sweeter', 'It is just a tradition'],
     1, 'On clean, wet glass the foam is dense and lasts longer.'),
    (3, 'What head of foam is considered right when serving a lager?',
     ['No foam', 'About two fingers', 'Half the glass', 'It does not matter'],
     1, 'The foam holds the aroma and protects the beer from air.'),
    (3, 'Which sign tells you the glass is clean?',
     ['Bubbles stick to the sides', 'The foam leaves even rings after each sip',
      'The foam disappears immediately', 'Drops remain on the glass'],
     1, 'On dirty glass bubbles stick to the sides and the foam quickly disappears.'),
    (3, 'A chocolate dessert goes better with...',
     ['A dry, bitter pilsner', 'A dark beer with coffee and caramel notes', 'The lightest lager', 'Any beer, no difference'],
     1, 'Roasted malt gives the same notes as chocolate: the flavors complement each other.'),

    (4, 'A guest has ordered a dish and is unsure about the drink. What do you do first?',
     ['Offer the most expensive beer', 'Ask what they like: lighter or fuller, a bit bitter or not',
      'Bring any beer', 'List the whole menu'],
     1, 'One or two questions give an accurate recommendation. A list of ten beers only confuses.'),
    (4, 'Which recommendation sounds more convincing?',
     ['"Take this one, it\'s popular"',
      '"This beer goes well with your dish: its caramel malt picks up the flavor of the crust"',
      '"This is the strongest one"', '"Take two at once"'],
     1, 'The formula works: dish, beer and reason.'),
    (4, 'A guest says they are driving. What do you do?',
     ['Offer a lighter beer', 'Offer a non-alcoholic drink', 'Offer a small serving',
      'Say that one pint doesn\'t count'],
     1, 'Alcohol is never offered in any amount to someone who is driving.'),
    (4, 'How often should draft beer lines be cleaned?',
     ['Once a year', 'About once every two weeks', 'Only when the beer turns sour', 'Never, the beer cleans them itself'],
     1, 'Yeast and bacteria build up in the lines. Without cleaning, the beer picks up sour and buttery notes.'),
    (4, 'Draft beer foams a lot when poured. What is the most common cause?',
     ['The beer is warm or the pressure is wrong', 'The glass is too clean', 'The beer is too cold', 'The beer has too little hops'],
     0, 'In warm beer the gas holds less well and goes straight into foam.'),
    (4, 'A guest looks younger than 21 and orders a beer. What do you do?',
     ['Sell it if they say they are 21', 'Politely ask for ID',
      'Sell a small serving', 'Ask their friends'],
     1, 'In Kazakhstan alcohol is sold from age 21. If in doubt, the seller must check the guest\'s age.'),
    (4, 'How many options is it best to offer a guest?',
     ['One or two: a familiar one and one "a step bolder"', 'Five or six', 'Every beer on the menu', 'None, let them choose'],
     0, 'A short choice is easier to accept. The second option gives the guest a chance to try something new.'),
    (4, 'A guest sent a glass back: the beer smells of wet cardboard. What do you do?',
     ['Explain that it is supposed to be like that', 'Apologize, replace the drink and check the batch date',
      'Add ice', 'Offer a discount to finish it'],
     1, 'A cardboard note is a sign of oxidation. The guest gets a new drink, and the batch gets checked.'),
]


# Описания ступеней под новые уроки. Старые стартовые тексты обещали то, чего в программе нет
# (дегустацию вслепую, «лексикон FlavorActiV»), поэтому заменяем их, если модератор их не правил.
LEVEL_DESCRIPTIONS = {
    1: 'What beer is made of, how lager differs from ale and how to read a label.',
    2: 'The flavor pyramid, step-by-step tasting and where notes come from.',
    3: 'Four pairing principles, Kazakh cuisine and proper serving.',
    4: 'Talking to a guest, the waiter\'s formula and what to do when something is wrong with the beer.',
}
OLD_LEVEL_DESCRIPTIONS = {
    1: 'Базовое знакомство с пивом: стили, крепость, плотность, первые ощущения от вкуса',
    2: 'Глубже в пирамиду: распознавание TOP/HEART/BASE нот, хмель vs солод',
    3: 'Food pairing, сезонность, температура подачи, анализ полного профиля',
    4: 'Профессиональный уровень: дегустация вслепую, описание по лексикону FlavorActiV, подбор пива для гостей',
}


def refresh_course_descriptions(Course):
    """Меняет стартовые описания ступеней на новые. Описания, которые правил модератор, не трогает."""
    changed = 0
    for level, text in LEVEL_DESCRIPTIONS.items():
        changed += Course.objects.filter(level=level, description=OLD_LEVEL_DESCRIPTIONS[level]).update(description=text)
    return changed


def load_lessons(Lesson, only_new=False):
    """
    Записывает стартовые уроки. Урок узнаётся по slug.
    only_new=True не трогает уже существующие уроки: правки модератора сохраняются.
    Возвращает число созданных и обновлённых уроков.
    """
    created = updated = 0
    counters = {}
    for item in LESSONS:
        order = counters.get(item['level'], 0)
        counters[item['level']] = order + 1
        fields = {
            'level': item['level'], 'title': item['title'], 'summary': item['summary'],
            'minutes': item['minutes'], 'blocks': item['blocks'], 'sort_order': order,
        }
        existing = Lesson.objects.filter(slug=item['slug']).first()
        if existing is None:
            Lesson.objects.create(slug=item['slug'], **fields)
            created += 1
        elif not only_new:
            for key, value in fields.items():
                setattr(existing, key, value)
            existing.save()
            updated += 1
    return created, updated


def load_questions(QuizQuestion):
    """Добавляет вопросы, которых ещё нет (сверка по ступени и тексту). Возвращает число добавленных."""
    added = 0
    existing = set(QuizQuestion.objects.values_list('level', 'text'))
    order = {}
    for level, text, options, correct, explanation in EXTRA_QUESTIONS:
        if (level, text) in existing:
            continue
        if level not in order:
            last = QuizQuestion.objects.filter(level=level).order_by('-sort_order').values_list('sort_order', flat=True).first()
            order[level] = (last if last is not None else -1) + 1
        QuizQuestion.objects.create(
            level=level, text=text, options=options, correct_index=correct,
            explanation=explanation, sort_order=order[level],
        )
        order[level] += 1
        added += 1
    return added

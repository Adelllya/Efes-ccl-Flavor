"""Prototype of Flavor Tree Pairing Engine v2 rules — used only to sanity-check formulas/ranges for the spec."""
import math, json, sys

def clamp(x, lo=0.0, hi=1.0): return lo if x < lo else hi if x > hi else x
def pos(x): return x if x > 0 else 0.0

# ---------- drink archetypes (14 axes; alcohol stored as abv) ----------
def K(id, cat, abv, sweet=0, acid=0, bitter=0, tannin=0, carb=0, body=.3, dairy=0, salt=0, umami=0, aroma=.3, roast=0, smoke=0, temp=6, tags=None, origin=None, ibu=None):
    return dict(id=id, cat=cat, abv=abv, ibu=ibu, sweet=sweet, acid=acid, bitter=bitter, tannin=tannin, carb=carb, body=body, dairy=dairy, salt=salt, umami=umami, aroma=aroma, roast=roast, smoke=smoke, temp=temp, tags=tags or {}, origin=origin or [])

DRINKS = [
 K("light_lager","beer",3.5,sweet=.15,acid=.25,bitter=.05,carb=.8,body=.2,aroma=.2,temp=4,tags={"grain":.3},ibu=10),
 K("pale_lager_intl","beer",5.0,sweet=.2,acid=.25,bitter=.22,tannin=.02,carb=.6,body=.35,aroma=.3,temp=5,tags={"grain":.5,"bread":.3},ibu=22,origin=["kazakh","international"]),
 K("czech_pale_premium","beer",4.4,sweet=.25,acid=.25,bitter=.5,tannin=.05,carb=.5,body=.5,aroma=.4,temp=6,tags={"bread":.7,"herbal":.5,"floral":.3},ibu=40,origin=["czech","german"]),
 K("german_pils","beer",4.8,sweet=.15,acid=.25,bitter=.4,tannin=.05,carb=.6,body=.4,aroma=.4,temp=5,tags={"herbal":.6,"grain":.4,"mineral":.4},ibu=33,origin=["german"]),
 K("helles","beer",5.0,sweet=.2,acid=.2,bitter=.2,tannin=.02,carb=.55,body=.5,aroma=.35,temp=6,tags={"bread":.7,"grain":.4},ibu=19,origin=["german"]),  # BJCP 4A: IBU 16-22, ABV 4.7-5.4, medium body, medium carbonation, "no residual sweetness"
 K("amber_lager","beer",5.2,sweet=.3,acid=.25,bitter=.3,tannin=.05,carb=.5,body=.5,aroma=.45,roast=.15,temp=8,tags={"caramel":.7,"bread":.6,"toast":.5},ibu=25,origin=["german","czech","austrian"]),
 K("czech_dark","beer",3.6,sweet=.35,acid=.25,bitter=.29,tannin=.1,carb=.45,body=.58,aroma=.5,roast=.3,temp=9,tags={"bread":.7,"caramel":.5,"chocolate":.3,"toast":.5,"nutty":.3},ibu=26,origin=["czech"]),  # BJCP 3D: IBU 18-34, SRM 17-35, medium to medium-full body, moderate-to-low carbonation, "very low to moderate roast"; KZ SKUs (Kozel Cerny 3.6, Zatecky Gus Cerny 3.5) are below BJCP ABV 4.4-5.8
 K("strong_lager","beer",7.3,sweet=.3,acid=.2,bitter=.35,tannin=.05,carb=.5,body=.6,aroma=.45,roast=.05,temp=8,tags={"grain":.5,"honey":.3,"warmth":.5},ibu=25),
 K("rice_lager","beer",4.0,sweet=.1,acid=.25,bitter=.15,carb=.65,body=.25,aroma=.2,temp=4,tags={"rice":1,"grain":.3},ibu=15,origin=["japanese","chinese"]),
 K("weissbier","beer",5.2,sweet=.25,acid=.35,bitter=.08,tannin=.02,carb=.9,body=.45,aroma=.55,temp=6,tags={"banana":.8,"clove":.6,"bread":.5,"wheat":.5,"dairy_cream":.3},ibu=12,origin=["german"]),
 K("witbier","beer",5.0,sweet=.2,acid=.4,bitter=.12,tannin=.02,carb=.85,body=.4,aroma=.55,temp=5,tags={"citrus":.8,"warm_spice":.5,"pepper":.3,"wheat":.5},ibu=14,origin=["belgian"]),
 K("american_pale_ale","beer",5.5,sweet=.2,acid=.3,bitter=.55,tannin=.1,carb=.6,body=.45,aroma=.7,temp=8,tags={"citrus":.8,"pine_resin":.5,"caramel":.3},ibu=40,origin=["american"]),
 K("american_ipa_45","beer",6.5,sweet=.2,acid=.3,bitter=.6,tannin=.12,carb=.6,body=.5,aroma=.8,temp=8,tags={"citrus":.8,"tropical_fruit":.6,"pine_resin":.5},ibu=45,origin=["american"]),
 K("double_ipa_85","beer",8.4,sweet=.25,acid=.3,bitter=1.0,tannin=.15,carb=.6,body=.55,aroma=.9,temp=10,tags={"citrus":.8,"tropical_fruit":.7,"pine_resin":.7},ibu=85,origin=["american"]),
 K("brown_ale","beer",5.5,sweet=.35,acid=.25,bitter=.35,tannin=.15,carb=.45,body=.55,aroma=.55,roast=.3,temp=10,tags={"caramel":.8,"nutty":.8,"toast":.6,"chocolate":.3},ibu=25,origin=["english"]),
 K("porter","beer",5.5,sweet=.3,acid=.25,bitter=.45,tannin=.2,carb=.45,body=.6,aroma=.6,roast=.6,smoke=.05,temp=11,tags={"chocolate":.7,"coffee":.5,"caramel":.5,"toast":.5},ibu=30,origin=["english"]),
 K("dry_stout","beer",4.3,sweet=.15,acid=.3,bitter=.55,tannin=.3,carb=.3,body=.6,aroma=.6,roast=.85,smoke=.05,temp=11,tags={"coffee":.8,"chocolate":.5,"roast":1,"dairy_cream":.3},ibu=38,origin=["irish","english"]),
 K("milk_stout","beer",5.2,sweet=.55,acid=.2,bitter=.35,tannin=.2,carb=.35,body=.7,dairy=.1,aroma=.6,roast=.7,temp=11,tags={"chocolate":.8,"coffee":.5,"dairy_cream":.6,"caramel":.5},ibu=28),
 K("imperial_stout","beer",10.0,sweet=.45,acid=.25,bitter=.85,tannin=.35,carb=.3,body=.95,aroma=.85,roast=.95,smoke=.05,temp=12,tags={"chocolate":1,"coffee":.8,"dark_fruit":.5,"roast":1,"warmth":.6},ibu=70),
 K("barleywine","beer",10.5,sweet=.5,acid=.2,bitter=.8,tannin=.25,carb=.3,body=.95,aroma=.8,roast=.1,temp=12,tags={"caramel":.9,"dark_fruit":.7,"toffee":.8,"warmth":.7},ibu=75),
 K("rauchbier","beer",5.4,sweet=.3,acid=.25,bitter=.3,tannin=.1,carb=.6,body=.5,aroma=.9,roast=.2,smoke=.8,temp=9,tags={"smoke":1,"bread":.5,"caramel":.5},ibu=25,origin=["german"]),
 K("kriek_sour","beer",5.5,sweet=.35,acid=.8,bitter=.1,tannin=.1,carb=.8,body=.4,aroma=.7,temp=6,tags={"red_fruit":1,"sour_lactic":.6,"oak_vanilla":.3},ibu=10,origin=["belgian"]),
 K("na_lager","na_beer",0.0,sweet=.3,acid=.3,bitter=.2,tannin=.02,carb=.6,body=.3,aroma=.3,temp=4,tags={"grain":.5,"bread":.3},ibu=18),
 K("radler","radler",2.5,sweet=.6,acid=.5,bitter=.1,carb=.8,body=.3,aroma=.5,temp=4,tags={"citrus":.9}),
 K("cider_dry","cider",5.7,sweet=.1,acid=.75,bitter=.1,tannin=.3,carb=.7,body=.35,aroma=.5,temp=7,tags={"orchard_fruit":1,"sour_lactic":.2},origin=["kazakh","english","french"]),
 K("cider_semi_dry","cider",5.0,sweet=.35,acid=.6,bitter=.05,tannin=.2,carb=.8,body=.35,aroma=.55,temp=6,tags={"orchard_fruit":1}),
 K("cider_sweet_commercial","cider",4.0,sweet=.6,acid=.5,bitter=.05,tannin=.1,carb=.8,body=.35,aroma=.6,temp=5,tags={"orchard_fruit":1,"caramel":.3}),
 K("white_dry","wine",12.0,sweet=.1,acid=.8,bitter=.05,tannin=.05,carb=0,body=.35,aroma=.6,temp=8,tags={"citrus":.8,"stone_fruit":.5,"mineral":.5,"herbal":.4}),
 K("riesling_off_dry","wine",9.5,sweet=.4,acid=.8,bitter=.05,tannin=.05,carb=0,body=.4,aroma=.6,temp=8,tags={"stone_fruit":.8,"citrus":.6,"honey":.4,"orchard_fruit":.5}),
 K("brut_sparkling","sparkling",12.0,sweet=.15,acid=.85,bitter=.1,tannin=.05,carb=1,body=.35,aroma=.5,temp=7,tags={"citrus":.7,"bread":.6,"orchard_fruit":.5,"mineral":.5}),
 K("demi_sec_sparkling","sparkling",12.0,sweet=.55,acid=.8,bitter=.05,tannin=.05,carb=1,body=.4,aroma=.5,temp=7,tags={"orchard_fruit":.6,"honey":.5,"citrus":.4}),
 K("red_light","wine",12.5,sweet=.05,acid=.65,bitter=.15,tannin=.4,carb=0,body=.5,aroma=.6,temp=14,tags={"red_fruit":.9,"floral":.3,"herbal":.3}),
 K("cabernet","wine",13.5,sweet=.05,acid=.5,bitter=.3,tannin=.8,carb=0,body=.7,aroma=.7,roast=.1,smoke=.05,temp=17,tags={"dark_fruit":.8,"oak_vanilla":.6,"herbal":.3,"pepper":.3}),
 K("shiraz","wine",14.0,sweet=.05,acid=.5,bitter=.3,tannin=.8,carb=0,body=.75,aroma=.75,roast=.1,smoke=.1,temp=17,tags={"dark_fruit":.8,"pepper":.6,"oak_vanilla":.5,"smoke":.2}),
 K("red_semi_sweet","wine",12.0,sweet=.55,acid=.55,bitter=.1,tannin=.4,carb=0,body=.55,aroma=.6,temp=14,tags={"dark_fruit":.9,"red_fruit":.6}),
 K("port","fortified",20.0,sweet=.85,acid=.4,bitter=.15,tannin=.5,carb=0,body=.9,aroma=.8,temp=16,tags={"dark_fruit":.9,"chocolate":.4,"nutty":.5,"warmth":.6}),
 K("aperol_spritz","cocktail",9.0,sweet=.5,acid=.5,bitter=.45,tannin=.05,carb=.7,body=.35,aroma=.7,temp=3,tags={"citrus":.9,"herbal":.5,"bitter_orange":.8}),
 K("negroni","cocktail",24.0,sweet=.45,acid=.1,bitter=.85,tannin=.1,carb=0,body=.7,aroma=.9,temp=4,tags={"bitter_orange":.9,"herbal":.7,"juniper":.5,"citrus":.5}),
 K("margarita","cocktail",17.0,sweet=.4,acid=.9,bitter=.15,tannin=0,carb=0,body=.4,aroma=.7,temp=2,tags={"citrus":1,"agave":.7,"brine":.3}),
 K("old_fashioned","cocktail",30.0,sweet=.35,acid=.05,bitter=.4,tannin=.15,carb=0,body=.8,aroma=.8,roast=.1,smoke=.05,temp=5,tags={"oak_vanilla":.8,"caramel":.7,"bitter_orange":.4,"warmth":.7}),
 K("manhattan","cocktail",28.0,sweet=.4,acid=.05,bitter=.45,tannin=.15,carb=0,body=.8,aroma=.85,roast=.1,temp=5,tags={"oak_vanilla":.7,"dark_fruit":.6,"herbal":.5,"cherry":.5,"warmth":.6}),
 K("gin_tonic","cocktail",8.0,sweet=.35,acid=.5,bitter=.5,carb=.9,body=.3,aroma=.6,temp=3,tags={"juniper":.8,"citrus":.7,"herbal":.4}),
 K("white_russian","cocktail",18.0,sweet=.6,acid=.05,bitter=.15,carb=0,body=.9,dairy=.7,aroma=.6,roast=.4,temp=3,tags={"coffee":.8,"dairy_cream":1,"warmth":.4}),
 K("whisky_neat","spirit",40.0,sweet=.15,acid=0,bitter=.2,tannin=.2,carb=0,body=.65,aroma=.8,roast=.1,smoke=.1,temp=18,tags={"oak_vanilla":.8,"caramel":.6,"honey":.4,"warmth":1}),
 K("cask_strength_whisky","spirit",58.0,sweet=.15,acid=0,bitter=.25,tannin=.25,carb=0,body=.7,aroma=.9,roast=.1,smoke=.1,temp=18,tags={"oak_vanilla":.8,"caramel":.6,"warmth":1}),
 K("peated_whisky","spirit",46.0,sweet=.1,acid=0,bitter=.25,tannin=.2,carb=0,body=.65,aroma=1,roast=.2,smoke=.8,temp=18,tags={"smoke":1,"brine":.6,"oak_vanilla":.5,"warmth":1}),
 K("vodka_neat","spirit",40.0,sweet=0,acid=0,bitter=.15,carb=0,body=.5,aroma=.05,temp=0,tags={"warmth":1}),
 K("mezcal","spirit",42.0,sweet=.15,acid=0,bitter=.2,tannin=.1,carb=0,body=.6,aroma=.9,roast=.1,smoke=.7,temp=18,tags={"smoke":1,"agave":.9,"warmth":1,"citrus":.3},origin=["mexican"]),
 K("kvass_classic","kvass",0.8,sweet=.45,acid=.5,bitter=.1,tannin=.02,carb=.6,body=.35,aroma=.5,roast=.1,temp=5,tags={"bread":1,"sour_lactic":.5,"caramel":.3},origin=["russian","kazakh"]),
 K("kvass_sour","kvass",1.0,sweet=.25,acid=.65,bitter=.1,tannin=.02,carb=.6,body=.3,aroma=.5,roast=.1,temp=5,tags={"bread":1,"sour_lactic":.8},origin=["russian","kazakh"]),
 K("lemonade_sweet","lemonade",0.0,sweet=1,acid=.6,bitter=.05,carb=.9,body=.3,aroma=.5,temp=4,tags={"citrus":1}),
 K("soda_water","water",0.0,sweet=0,acid=.2,bitter=0,carb=1,body=.05,aroma=0,temp=4,tags={"mineral":.5}),
 K("ayran","dairy",0.0,sweet=.05,acid=.55,bitter=0,carb=.1,body=.5,dairy=.6,salt=.4,umami=.1,aroma=.4,temp=5,tags={"dairy_cream":1,"sour_lactic":.8,"brine":.3},origin=["kazakh","central_asian","turkish"]),
 K("kumys","dairy",1.5,sweet=.1,acid=.8,bitter=.05,carb=.3,body=.3,dairy=.4,salt=.05,umami=.1,aroma=.5,temp=6,tags={"sour_lactic":1,"dairy_cream":.5,"yeast":.5},origin=["kazakh","central_asian"]),
 K("shubat","dairy",1.0,sweet=.1,acid=.7,bitter=0,carb=.15,body=.7,dairy=.9,salt=.2,umami=.1,aroma=.5,temp=6,tags={"sour_lactic":.9,"dairy_cream":1,"brine":.3},origin=["kazakh","central_asian"]),
 K("black_tea_strong","tea",0.0,sweet=0,acid=.15,bitter=.4,tannin=.6,carb=0,body=.35,aroma=.6,roast=.2,temp=70,tags={"tannic":.5,"honey":.2,"smoke":.1},origin=["kazakh","central_asian","english"]),
 K("green_tea","tea",0.0,sweet=0,acid=.2,bitter=.35,tannin=.4,carb=0,body=.25,umami=.2,aroma=.5,temp=70,tags={"grass":.8,"herbal":.5},origin=["japanese","chinese"]),
]
DRINK_BY_ID = {d["id"]: d for d in DRINKS}

# ---------- dishes (v2 vectors) ----------
def Dd(id, name, salt=0, sweet=0, sour=0, bitter=0, umami=0, fat=0, protein=0, heat=0, pungent=0, weight=.5, cream=0, maillard=0, smoke=0, fresh=0, fish_oil=0, green_iron=0, dessert=False, cold=False, vinegar=False, cuisine=None, tags=None):
    return dict(id=id, name=name, salt=salt, sweet=sweet, sour=sour, bitter=bitter, umami=umami, fat=fat, protein=protein, heat=heat, pungent=pungent, weight=weight, cream=cream, maillard=maillard, smoke=smoke, fresh=fresh, fish_oil=fish_oil, green_iron=green_iron, dessert=dessert, cold=cold, vinegar=vinegar, cuisine=cuisine or [], tags=tags or {})

DISHES = [
 Dd("beshbarmak","Бешбармак",salt=.5,umami=.85,fat=.8,protein=.9,pungent=.3,weight=.9,fresh=.1,cuisine=["kazakh"],tags={"bread":.8,"broth":.7,"onion":.5,"lamb":.8}),
 Dd("kazy","Казы",salt=.8,umami=.8,fat=.9,protein=.9,pungent=.4,weight=.8,smoke=.5,cuisine=["kazakh"],tags={"garlic":.6,"pepper":.6,"cured":.8,"smoke":.5}),
 Dd("kuyrdak","Куырдак",salt=.5,umami=.85,fat=.85,protein=.9,pungent=.4,weight=.85,maillard=.7,cuisine=["kazakh"],tags={"onion":.6,"fried":.7}),
 Dd("shashlyk","Шашлык",salt=.5,umami=.85,fat=.55,protein=.9,pungent=.3,weight=.8,smoke=.85,maillard=.8,cuisine=["kazakh","caucasian"],tags={"smoke":1,"char":.9,"pepper":.5,"onion":.5,"lamb":.8}),
 Dd("plov","Плов",salt=.45,sweet=.25,umami=.7,fat=.6,protein=.6,weight=.85,maillard=.35,cuisine=["central_asian","kazakh"],tags={"rice":1,"warm_spice":.7,"caramel":.4,"lamb":.6}),
 Dd("kurt","Курт",salt=.8,sour=.7,umami=.4,fat=.2,protein=.7,weight=.2,cream=.3,cold=True,cuisine=["kazakh"],tags={"cheese":1,"sour_lactic":.8,"brine":.5}),
 Dd("samsa","Самса",salt=.5,umami=.7,fat=.6,protein=.7,pungent=.3,weight=.7,maillard=.7,cuisine=["central_asian","kazakh"],tags={"bread":.8,"onion":.5,"warm_spice":.4,"lamb":.6}),
 Dd("manty","Манты",salt=.45,umami=.7,fat=.55,protein=.7,pungent=.3,weight=.7,fresh=.2,cuisine=["central_asian","kazakh"],tags={"bread":.6,"onion":.5,"pepper":.4}),
 Dd("lagman-spicy","Лагман острый",salt=.5,sweet=.05,sour=.15,umami=.7,fat=.5,protein=.7,heat=.6,pungent=.5,weight=.8,maillard=.4,smoke=.1,fresh=.1,cuisine=["central_asian","uyghur"],tags={"bread":.4,"lamb":.6,"pepper":.6,"warm_spice":.5,"garlic":.5,"tomato":.4}),
 Dd("chak-chak","Чак-чак",sweet=.9,fat=.5,protein=.1,weight=.5,maillard=.5,dessert=True,cuisine=["kazakh","tatar"],tags={"honey":1,"bread":.6,"fried":.5}),
 Dd("okroshka","Окрошка",salt=.5,sour=.6,umami=.3,fat=.3,protein=.4,pungent=.4,weight=.3,cream=.3,fresh=.7,cold=True,cuisine=["russian"],tags={"cucumber":1,"herbal":.8,"sour_lactic":.6,"egg":.4}),
 Dd("sushi","Суши (нигири)",salt=.35,sour=.3,umami=.7,fat=.25,protein=.6,weight=.25,fresh=.8,fish_oil=.5,cold=True,cuisine=["japanese"],tags={"rice":1,"fish":.8,"seaweed":.5,"brine":.4}),
 Dd("ramen","Рамен",salt=.7,umami=.9,fat=.55,protein=.6,weight=.8,cuisine=["japanese"],tags={"broth":1,"pork":.6,"egg":.4,"bread":.3}),
 Dd("steak","Стейк",salt=.5,umami=.9,fat=.55,protein=.95,weight=.85,smoke=.5,maillard=.85,cuisine=["american","argentinian"],tags={"beef":1,"char":.8,"butter":.5,"herbal":.5}),
 Dd("burger","Бургер",salt=.6,sweet=.2,umami=.85,fat=.85,protein=.8,pungent=.3,weight=.9,cream=.3,smoke=.4,maillard=.7,cuisine=["american"],tags={"beef":.9,"cheese":.6,"bacon":.5,"bread":.7,"smoke":.4,"onion":.5}),
 Dd("bbq-ribs","Рёбрышки BBQ",salt=.5,sweet=.6,umami=.8,fat=.85,protein=.8,weight=.9,smoke=.9,maillard=.7,cuisine=["american"],tags={"smoke":1,"caramel":.8,"pork":.8,"molasses":.6,"pepper":.4}),
 Dd("buffalo-wings","Крылышки Buffalo",salt=.6,sour=.3,umami=.5,fat=.75,protein=.7,heat=.85,weight=.55,cream=.3,maillard=.6,cuisine=["american"],tags={"chili":.9,"butter":.6,"cheese":.3}),
 Dd("nachos","Начос",salt=.8,sour=.2,umami=.5,fat=.75,protein=.4,heat=.6,weight=.55,cream=.5,maillard=.5,cuisine=["mexican","american"],tags={"cheese":.8,"corn":.8,"chili":.6,"tomato":.4}),
 Dd("tacos","Тако",salt=.5,sour=.3,umami=.65,fat=.5,protein=.6,heat=.6,pungent=.4,weight=.5,smoke=.3,maillard=.7,fresh=.4,cuisine=["mexican"],tags={"corn":.6,"citrus":1,"herbal":.6,"chili":.7,"onion":.5}),
 Dd("chili-con-carne","Чили кон карне",salt=.5,sweet=.15,sour=.2,umami=.8,fat=.5,protein=.7,heat=.75,weight=.8,cuisine=["mexican","american"],tags={"beef":.7,"beans":.5,"chili":.9,"warm_spice":.7,"tomato":.5}),
 Dd("mac-and-cheese","Мак-энд-чиз",salt=.5,umami=.7,fat=.85,protein=.5,weight=.8,cream=.9,maillard=.3,cuisine=["american"],tags={"cheese":1,"butter":.7,"dairy_cream":.9}),
 Dd("tiramisu","Тирамису",sweet=.85,fat=.6,protein=.2,weight=.5,cream=.8,dessert=True,cuisine=["italian"],tags={"coffee":1,"cocoa":.8,"chocolate":.7,"dairy_cream":.8}),
 Dd("strudel","Штрудель",sweet=.75,sour=.2,fat=.4,protein=.1,weight=.5,maillard=.4,dessert=True,cuisine=["austrian","german"],tags={"orchard_fruit":.9,"warm_spice":.7,"caramel":.6,"bread":.5,"butter":.4}),
 Dd("caprese","Капрезе",salt=.3,sour=.55,fat=.35,protein=.4,weight=.25,cream=.4,fresh=.85,cold=True,cuisine=["italian"],tags={"tomato":1,"cheese":.6,"herbal":.7,"dairy_cream":.4}),
 Dd("kartoffelsalat","Картофельный салат",salt=.5,sour=.5,umami=.3,fat=.4,protein=.2,pungent=.4,weight=.5,vinegar=True,cuisine=["german"],tags={"potato":1,"mustard":.5,"bacon":.4}),
 Dd("schnitzel","Шницель",salt=.45,sour=.15,umami=.65,fat=.8,protein=.8,weight=.8,maillard=.75,cuisine=["german","austrian"],tags={"fried":.8,"bread":.6,"pork":.8,"citrus":.4,"butter":.5}),
 Dd("bratwurst","Братвурст / вайсвурст",salt=.7,umami=.7,fat=.85,protein=.8,pungent=.4,weight=.8,smoke=.5,maillard=.5,cuisine=["german"],tags={"pork":.9,"smoke":.5,"herbal":.4,"mustard":.5}),
 Dd("weisswurst","Вайсвурст",salt=.6,umami=.6,fat=.6,protein=.8,pungent=.3,weight=.55,fresh=.2,cuisine=["german","bavarian"],tags={"pork":.8,"herbal":.6,"mustard":.5,"citrus":.3,"dairy_cream":.2}),
 Dd("pretzel","Брецель",salt=.8,umami=.2,fat=.2,protein=.2,weight=.4,maillard=.5,cuisine=["german"],tags={"bread":1,"salt":.8,"toast":.6}),
 Dd("edamame","Эдамаме",salt=.8,umami=.3,fat=.15,protein=.5,weight=.2,fresh=.6,cuisine=["japanese"],tags={"beans":1,"green":.6}),
 Dd("oysters-raw","Устрицы сырые",salt=.6,sour=.3,umami=.7,fat=.2,protein=.5,weight=.2,fresh=.9,fish_oil=.3,cold=True,cuisine=["french","irish"],tags={"brine":1,"mineral":1,"citrus":.4}),
 Dd("mussels-steamed","Мидии на пару",salt=.5,sour=.2,umami=.6,fat=.3,protein=.5,pungent=.3,weight=.35,fresh=.5,fish_oil=.2,cuisine=["belgian","french"],tags={"brine":.6,"herbal":.5,"garlic":.4,"citrus":.3}),
 Dd("grilled-trout","Форель на гриле",salt=.4,umami=.6,fat=.4,protein=.7,weight=.4,maillard=.5,smoke=.3,fresh=.4,fish_oil=.5,cuisine=["international"],tags={"citrus":.5,"herbal":.4,"char":.4}),
 Dd("roast-pork","Свинина запечённая",salt=.5,umami=.8,fat=.7,protein=.9,weight=.8,maillard=.8,cuisine=["german","czech"],tags={"caramel":.6,"pork":1,"herbal":.3,"char":.4}),
 Dd("chocolate-fondant","Шоколадный фондан",sweet=.85,bitter=.3,fat=.6,protein=.2,weight=.55,cream=.3,dessert=True,cuisine=["french"],tags={"chocolate":1,"cocoa":1,"butter":.5}),
 Dd("chicken-curry","Карри с курицей",salt=.5,sweet=.15,sour=.1,umami=.6,fat=.55,protein=.6,heat=.55,pungent=.4,weight=.65,cream=.4,maillard=.2,cuisine=["indian"],tags={"warm_spice":.9,"citrus":.3,"herbal":.4,"dairy_cream":.4,"chili":.5}),
 Dd("cheesecake","Чизкейк",sweet=.85,sour=.2,fat=.7,protein=.3,weight=.55,cream=.9,dessert=True,cuisine=["american"],tags={"dairy_cream":1,"biscuit":.5,"vanilla":.5,"citrus":.3}),
 Dd("burrata","Буррата",salt=.3,sour=.1,umami=.3,fat=.6,protein=.5,weight=.3,cream=.9,fresh=.8,cold=True,cuisine=["italian"],tags={"dairy_cream":1,"herbal":.3,"olive":.4}),
 Dd("salmon-grilled","Лосось на гриле",salt=.45,umami=.7,fat=.7,protein=.8,weight=.55,maillard=.6,smoke=.3,fresh=.3,fish_oil=.9,cuisine=["international"],tags={"citrus":.4,"char":.4}),
 Dd("asparagus-grilled","Спаржа на гриле",salt=.2,sweet=.1,bitter=.3,umami=.6,fat=.2,protein=.2,weight=.25,maillard=.3,fresh=.6,green_iron=.8,cuisine=["french"],tags={"herbal":.6,"green":.8,"butter":.3}),
 Dd("beef-tartare","Тартар из говядины",salt=.4,sour=.3,umami=.8,fat=.4,protein=.8,pungent=.5,weight=.35,fresh=.9,cold=True,cuisine=["french"],tags={"beef":1,"citrus":.3,"mustard":.5,"egg":.4}),
 Dd("cheese-aged","Выдержанный сыр / рокфор",salt=.8,bitter=.1,umami=.8,fat=.8,protein=.9,weight=.6,cream=.3,cuisine=["french","english"],tags={"cheese":1,"nutty":.6,"brine":.4,"dairy_cream":.5}),
 Dd("dark-chocolate","Тёмный шоколад 70%",sweet=.5,bitter=.7,fat=.5,protein=.2,weight=.5,dessert=True,cuisine=["international"],tags={"chocolate":1,"cocoa":1,"coffee":.3,"dark_fruit":.3}),
 Dd("risotto","Ризотто",salt=.45,umami=.7,fat=.55,protein=.4,weight=.55,cream=.7,cuisine=["italian"],tags={"rice":1,"cheese":.6,"butter":.6,"dairy_cream":.7}),
]
DISH_BY_ID = {d["id"]: d for d in DISHES}

# ---------- helpers ----------
FRUIT_TAGS = ["red_fruit","orchard_fruit","stone_fruit","dark_fruit","tropical_fruit","citrus","cherry"]

def burn(abv):
    if abv < 7: return 0.0
    if abv <= 12: return 0.3 * (abv - 7) / 5
    if abv <= 22: return 0.3 + 0.3 * (abv - 12) / 10
    if abv <= 40: return 0.6 + 0.4 * (abv - 22) / 18
    return 1.0
def cold(t): return clamp((12 - t) / 8)
def alc(b): return clamp(b["abv"] / 40)

# --- two-dimensional intensity (CMS: "weight with weight"; BA: "match strength with strength") ---
def W_B(b):  # weight / richness of the drink
    return clamp(0.55*b["body"] + 0.25*clamp(b["abv"]/20) + 0.20*b["sweet"])
def F_B(b):  # flavour loudness of the drink (BA: "alcoholic strength, malt character, hop bitterness, sweetness, richness, roastiness")
    return clamp(0.30*b["aroma"] + 0.25*b["bitter"] + 0.20*b["roast"] + 0.10*b["smoke"] + 0.10*b["tannin"] + 0.05*b["acid"] + 0.15*burn(b["abv"]))
def W_D(d):
    w = clamp(0.40*d["weight"] + 0.30*d["fat"] + 0.10*d["cream"] + 0.10*d["protein"])
    if d["dessert"]: w = max(w, clamp(0.4*d["sweet"] + 0.4*d["fat"] + 0.2*d["cream"]))
    return w
def F_D(d):
    f = clamp(0.15*d["heat"] + 0.15*d["smoke"] + 0.20*d["salt"] + 0.20*d["umami"] + 0.10*d["maillard"]
              + 0.15*d["sour"] + 0.05*d["sweet"] + 0.05*d["pungent"] + 0.05*d["bitter"])
    if d["dessert"]:
        choc = max(d["tags"].get("chocolate",0), d["tags"].get("cocoa",0), d["tags"].get("coffee",0))
        f = max(f, clamp(0.45*d["sweet"] + 0.30*d["bitter"] + 0.25*choc))
    return f
# legacy composites kept for reporting
def I_B(b): return clamp(0.5*W_B(b) + 0.5*F_B(b))
def I_D(d): return clamp(0.5*W_D(d) + 0.5*F_D(d))

# R20 classic pairs — documented classics (source in comment); +6 and a badge, never a type override
CLASSICS = {
 ("oysters-raw","dry_stout"): "BA chart 14: dry stout 'a classic with raw oysters'",
 ("weisswurst","weissbier"): "BA chart 17: hefeweizen 'classic with weisswurst'",
 ("mussels-steamed","witbier"): "BA chart 19: witbier 'classic with steamed mussels'",
 ("chicken-curry","american_ipa_45"): "BA chart 4: IPA 'classic with curry!'",
 ("chocolate-fondant","imperial_stout"): "BA p.7: 'Flourless chocolate cake or truffles call for an inky imperial stout'",
 ("roast-pork","amber_lager"): "BA p.4: 'rich, caramelly flavors of an Oktoberfest lager and roasted pork'",
 ("schnitzel","czech_pale_premium"): "BA p.5: 'Schnitzel with pale lager may be obvious'",
 ("burger","brown_ale"): "Oliver (Oxford Companion): 'A brown ale works so nicely with a hamburger'",
 ("steak","cabernet"): "WSET 2023 (Barolo/steak), CMS 'Tannins love fat'",
 ("okroshka","kvass_sour"): "tea.ru / Ochakovo: к окрошке — кислый, не сладкий квас",
 ("beshbarmak","kumys"): "национальная классика (Yurta кумысная карта, Tatler) — уровень C",
}

def score_pair(b, d, ctx=None, use_classics=True):
    ctx = ctx or {}
    tol = ctx.get("harsh_tol", 1.0); heat_lover = 1.0 if ctx.get("heat_lover") else 0.0
    out = []; vetoes = []
    def add(rid, pts, fam, txt): out.append((rid, round(pts, 2), fam, txt))
    salt_soft = 1 - 0.45*d["salt"]
    # ---- R1 intensity_match, two dimensions ----
    wb, fb, wd, fd = W_B(b), F_B(b), W_D(d), F_D(d)
    wb_eff = wb + (0.25*max(b["acid"], 0.8*b["carb"], b["salt"], b["tannin"]) if wb < wd else 0.0)   # CMS exception: light body saved by acid / cut (tannin, CO2)
    dW = wb_eff - wd; dF = fb - fd
    strong_cheese_or_cured = d["protein"] >= .8 and d["salt"] >= .7 and d["fat"] >= .7            # BA: barley wine/imperial stout "best with strong cheese", "stands up to foie gras, smoked goose"
    k_loud = 35 if strong_cheese_or_cured else 70
    pts = 20 - (k_loud*dF if dF > 0 else 45*(-dF)) - (25*abs(dW))
    add("R1", clamp(pts, -15, 20), "balance", f"W {wb:.2f}->{wb_eff:.2f} vs {wd:.2f} (dW={dW:+.2f}); F {fb:.2f} vs {fd:.2f} (dF={dF:+.2f})")
    if (dF >= 0.35 or (dF >= 0.20 and dW >= 0.30)) and not d["dessert"] and not strong_cheese_or_cured: vetoes.append("V1_overpower")
    if dF <= -0.40 or (dF <= -0.20 and dW <= -0.33): vetoes.append("V6_drowned")
    # a drink that shouts over the dish gets no credit for "refreshing" or "complementing" it (BA principle #1 gates the rest)
    fit = 1 - clamp((dF - 0.15) / 0.35) if not strong_cheese_or_cured else 1 - clamp((dF - 0.30) / 0.35)
    def addfit(rid, pts, fam, txt): add(rid, pts*fit if pts > 0 else pts, fam, txt + (f" fit={fit:.2f}" if fit < 1 and pts > 0 else ""))
    # ---- R2 cut_richness ----
    rich = max(d["fat"], 0.8*d["cream"], 0.6*d["weight"])
    if rich >= 0.3:
        bitter_term = 0.20*b["bitter"]*(1 - 0.7*d["heat"])
        cp = 0.30*b["tannin"] + bitter_term + 0.15*b["carb"]*(1 - 0.5*d["cream"]) + 0.15*b["acid"] + 0.05*b["roast"] + 0.10*alc(b)
        addfit("R2", clamp(30*rich*cp, 0, 20), "cut", f"rich={rich:.2f} cut_power={cp:.2f}")
    # ---- R3 chili_heat ----
    if d["heat"] >= 0.15:
        relief = 0.30*clamp(b["sweet"]/0.6) + 0.50*b["dairy"] + 0.15*cold(b["temp"]) + 0.10*b["body"]
        hop = pos(b["bitter"]-0.5)/0.5
        aggr = (0.50*burn(b["abv"]) + 0.40*hop*salt_soft + 0.30*hop*clamp((b["abv"]-5)/4) + 0.12*b["tannin"] + 0.08*pos(b["carb"]-0.6)/0.4)
        pts = d["heat"]*(36*relief - 90*aggr*tol*(1 - 0.85*heat_lover))   # heat_lover: amplification is the desired effect (BA "emphasizes"; Oliver; Hop Culture)
        add("R3", clamp(pts, -36, 18), "cut" if pts >= 0 else "penalty", f"relief={relief:.2f} aggr={aggr:.2f}")
        if d["heat"] >= 0.6 and b["abv"] >= 30 and not heat_lover: vetoes.append("V3_fire")
    # ---- R4 sweet_match ----
    if d["sweet"] >= 0.3:
        gap = d["sweet"] - b["sweet"]
        if gap <= 0.2: pts = 8 + 6*b["sweet"]*d["sweet"] if gap <= 0 else 8*(1 - gap/0.2)
        else: pts = -30*(gap - 0.2)
        contrast = d["dessert"] and b["cat"] in ("beer",) and b["bitter"] >= 0.75 and abs(dF) < 0.3   # BA: "highly hopped beers such as double IPAs" — beer only
        if contrast: pts = max(pts, 6)
        choc = min(b["roast"], max(d["tags"].get("chocolate",0), d["tags"].get("cocoa",0)))
        pts += 10*choc                                   # BA: "Chocolate loves a dark beer"
        pts += 8*b["roast"]*d["sweet"]                   # BA table: Roasted Malt balances Sweetness (dry stout <-> tiramisu in BA chart)
        fruit = sum(min(b["tags"].get(t,0), d["tags"].get(t,0)) for t in FRUIT_TAGS)   # same fruit family only
        pts += 6*min(fruit, 1.0)*(1 if d["dessert"] else 0.5)
        add("R4", clamp(pts, -24, 22), "contrast" if contrast else ("complement" if pts >= 0 else "penalty"), f"gap={gap:.2f}")
        if d["dessert"] and d["sweet"] >= 0.6 and b["sweet"] <= 0.15 and not contrast: vetoes.append("V2_dry_vs_dessert")
    # ---- R5 acid_match ----
    if d["sour"] >= 0.25:
        eff_sour = d["sour"] + (0.2 if d["vinegar"] else 0)
        eff_acid = max(b["acid"], 0.6*b["carb"])
        gap = eff_sour - eff_acid
        pts = -22*gap*(1.5 if d["vinegar"] else 1) if gap > 0 else 10*min(b["acid"], d["sour"])
        if b["tannin"] >= 0.3: pts -= 8*b["tannin"]*d["sour"]
        if not d["dessert"]: pts -= 12*pos(b["sweet"]-0.4)*d["sour"]
        add("R5", clamp(pts, -20, 12), "cut" if pts >= 0 else "penalty", f"gap={gap:.2f}")
    # ---- R6 salt_modulation ----
    if d["salt"] >= 0.35:
        forgive = 8*d["salt"]*(b["bitter"]*(1 - d["heat"]) + 0.75*b["tannin"])          # Breslin; CMS "salt… softens tannins"
        clean = 6*d["salt"]*max(b["acid"], b["carb"])                                   # CMS "Acidity cuts saltiness"
        shield = 1 - 0.6*max(d["fat"], d["protein"])                                     # Whisky School: fat/protein shield receptors from spirit
        alco = -12*d["salt"]*pos(alc(b) - 0.35)/0.65*shield                              # Goldstein; CMS "Alcohol… accentuated… salt"
        tann = -2*d["salt"]*pos(b["tannin"]-0.6)/0.4                                     # Gaiser (contested by CMS) — halved
        snack = 4 if (d["salt"] >= .7 and d["weight"] <= .45 and b["carb"] >= .5 and b["bitter"] >= .3) else 0
        pts = min(forgive, 8) + clean + alco + tann + snack
        addfit("R6", clamp(pts, -12, 14), "complement" if pts >= 0 else "penalty", f"forgive={forgive:.1f} clean={clean:.1f} alco={alco:.1f}")
    # ---- R7 umami ----
    if d["umami"] >= 0.4:
        if d["salt"] < 0.4 and d["sour"] < 0.3:
            pts = -14*d["umami"]*(0.5*b["tannin"] + 0.3*b["bitter"] + 0.2*alc(b))*tol
        else:
            pts = 8*d["umami"]*(0.5*b["bitter"] + 0.5*b["acid"]) + 4*min(b["umami"], d["umami"])
        addfit("R7", clamp(pts, -12, 10), "complement" if pts >= 0 else "penalty", "")
    # ---- R8 tannin_protein (category-specific) ----
    if b["tannin"] >= 0.25:
        plus = 16*b["tannin"]*max(d["protein"], d["fat"])*(1 if d["protein"] >= .4 else .5)
        fish = -20*b["tannin"]*d["fish_oil"]
        green = -10*b["tannin"]*d["green_iron"]
        dry = -6*b["tannin"]*(1 - max(d["protein"], d["fat"])) if b["tannin"] >= .5 else 0
        pts = plus + fish + green + dry
        addfit("R8", clamp(pts, -22, 16), "complement" if pts >= 0 else "penalty", f"plus={plus:.1f} fish={fish:.1f} green={green:.1f}")
        if b["tannin"] >= .5 and d["fish_oil"] >= .6: vetoes.append("V4_tannin_fish")
    # ---- R9 delicate_fresh ----
    if d["fresh"] >= 0.3:
        pts = d["fresh"]*(8*b["carb"] + 6*(1-b["aroma"]) + 4*b["acid"] - 10*b["roast"] - 10*pos(b["body"]-.55)/.45 - 12*pos(alc(b)-.25)/.75 - 6*pos(b["bitter"]-.5)/.5 - 6*b["smoke"])
        pts -= 8*d["fish_oil"]*pos(b["bitter"]-.6)/.4
        add("R9", clamp(pts, -16, 12), "cut" if pts >= 0 else "penalty", "")
        if d["fresh"] >= .6 and b["abv"] >= 35: vetoes.append("V5_spirit_vs_delicate")
    # ---- R10 maillard_harmony ----
    if d["maillard"] >= 0.3:
        m = max(b["tags"].get("caramel",0), b["roast"]*max(d["smoke"], d["tags"].get("char",0)), 0.6*b["tags"].get("bread",0), b["tags"].get("oak_vanilla",0), 0.8*b["tags"].get("toast",0), 0.7*b["tags"].get("nutty",0))
        addfit("R10", clamp(12*d["maillard"]*m, 0, 12), "complement", f"m={m:.2f}")
    # ---- R11 smoke_bridge ----
    if d["smoke"] >= 0.3:
        addfit("R11", clamp(12*min(d["smoke"], b["smoke"]) + 5*d["smoke"]*b["roast"], 0, 14), "bridge", "")
    # ---- R12 aroma_bridge ----
    shared = sum(min(w, d["tags"].get(t, 0)) for t, w in b["tags"].items() if t in d["tags"])
    if shared > 0: addfit("R12", clamp(8*shared, 0, 8), "bridge", ",".join(t for t in b["tags"] if t in d["tags"]))
    # ---- R14 same_on_same ----
    pen = -8*b["bitter"]*d["bitter"]
    if b["cat"] in ("cocktail","fortified") and b["sweet"] > .5 and d["sweet"] > .5 and not d["dessert"]: pen -= 6
    if pen < -0.5: add("R14", clamp(pen, -8, 0), "penalty", "")
    # ---- R13 both_principles ----
    fams = {}
    for rid, pts, fam, _ in out:
        if pts >= 3: fams[fam] = fams.get(fam, 0) + 1
    if ("cut" in fams or "contrast" in fams) and ("complement" in fams or "bridge" in fams): addfit("R13", 4, "balance", "cut+complement")
    # ---- R20 classic_pairs ----
    if use_classics and (d["id"], b["id"]) in CLASSICS: add("R20", 8, "complement", "classic: " + CLASSICS[(d["id"], b["id"])])
    # ---- R15 regional ----
    if set(b["origin"]) & set(d["cuisine"]): add("R15", 4, "context", "region")
    core = sum(p for rid, p, f, _ in out if f != "context")
    ctxp = sum(p for rid, p, f, _ in out if f == "context")
    occ = ctx.get("occasion")
    if occ == "meal": ctxp += 6*(1 if (b["abv"] <= 12 and b["carb"] >= .5) else 0) - (8 if (b["abv"] >= 25 and not d["dessert"]) else 0) - 12*pos(alc(b)-.5)/.5
    score = int(round(45 + 0.9*core + ctxp))
    if any(v.startswith(("V1","V2","V3","V4","V5")) for v in vetoes): score = min(score, 35)
    if "V6_drowned" in vetoes: score = min(score, 50)
    score = int(clamp(score, 3, 99))
    return dict(score=score, core=round(core,1), ctx=round(ctxp,1), contribs=out, vetoes=vetoes, W=(round(wb,2),round(wd,2)), F=(round(fb,2),round(fd,2)))

# ---------- test pairs ----------
TESTS = [
 ("oysters-raw","dry_stout","good"),("oysters-raw","brut_sparkling","top3"),("mussels-steamed","witbier","top3"),
 ("schnitzel","czech_pale_premium","good"),("grilled-trout","german_pils","good"),("roast-pork","amber_lager","top3"),
 ("chocolate-fondant","imperial_stout","top3"),("tiramisu","porter","good"),("bbq-ribs","strong_lager","good"),
 ("chicken-curry","american_ipa_45","good"),("buffalo-wings","double_ipa_85","bad"),("buffalo-wings","helles","good"),
 ("cheesecake","double_ipa_85","good"),("chocolate-fondant","light_lager","avoid"),("caprese","barleywine","avoid"),
 ("sushi","rice_lager","top3"),("sushi","imperial_stout","avoid"),("kazy","rauchbier","top3"),("kazy","czech_pale_premium","good"),
 ("beshbarmak","czech_dark","top3"),("beshbarmak","rice_lager","bad"),("kurt","german_pils","good"),("burger","brown_ale","good"),
 ("steak","porter","good"),("plov","amber_lager","good"),("burrata","weissbier","good"),("weisswurst","weissbier","top3"),
 ("steak","cabernet","top3"),("salmon-grilled","cabernet","avoid"),("salmon-grilled","white_dry","good"),("asparagus-grilled","shiraz","bad"),
 ("chak-chak","brut_sparkling","avoid"),("chak-chak","milk_stout","good"),("chak-chak","port","good"),
 ("lagman-spicy","riesling_off_dry","good"),("lagman-spicy","whisky_neat","avoid"),("tacos","margarita","good"),("nachos","aperol_spritz","good"),
 ("strudel","negroni","bad"),("beef-tartare","cask_strength_whisky","avoid"),("cheese-aged","peated_whisky","good"),("dark-chocolate","manhattan","good"),
 ("bbq-ribs","cider_semi_dry","good"),("mac-and-cheese","cider_dry","good"),("ramen","czech_pale_premium","good"),
 ("okroshka","kvass_sour","top3"),("beshbarmak","kumys","good"),("lagman-spicy","ayran","good"),
 ("lagman-spicy","soda_water","bad"),("samsa","pale_lager_intl","good"),("manty","czech_pale_premium","good"),
 ("kartoffelsalat","cabernet","bad"),("kartoffelsalat","cider_dry","good"),("chili-con-carne","ayran","good"),("shashlyk","mezcal","good"),
 ("shashlyk","czech_dark","good"),("pretzel","na_lager","good"),("beshbarmak","old_fashioned","bad"),
 # added in v2.1
 ("beshbarmak","imperial_stout","avoid"),("beshbarmak","double_ipa_85","bad"),("weisswurst","dry_stout","bad"),
 ("sushi","brut_sparkling","good"),("kurt","aperol_spritz","good"),("plov","green_tea","good"),("steak","black_tea_strong","good"),
 ("caprese","white_dry","good"),("lagman-spicy","lemonade_sweet","good"),("tiramisu","brut_sparkling","avoid"),
]
# ordinal constraints (dish, better_drink, worse_drink, min_gap, ctx)
ORDINALS = [
 ("okroshka","kvass_sour","kvass_classic",1,{}, "tea.ru/Ochakovo: кислый квас > сладкий к окрошке"),
 ("buffalo-wings","helles","double_ipa_85",8,{}, "панель Sam Adams: helles > DIPA-85 (обычный гость)"),
 ("buffalo-wings","american_ipa_45","helles",0,{}, "панель: 45 IBU/6.5 % ↓ heat; BA IPA+curry"),
 ("buffalo-wings","double_ipa_85","helles",0,{"heat_lover":True}, "heat_lover переворачивает порядок (Oliver, BA, Hop Culture)"),
 ("lagman-spicy","ayran","soda_water",15,{}, "Nolden 2019: молоко >> сельтерская"),
 ("lagman-spicy","ayran","lemonade_sweet",-5,{}, "Nolden/Nasrawi: молоко ≥ сахар (−5 допуск)"),
 ("steak","cabernet","czech_pale_premium",1,{}, "CMS/WSET: танин × белок"),
 ("sushi","rice_lager","brut_sparkling",1,{}, "BA/Marrero"),
 ("sushi","brut_sparkling","imperial_stout",20,{}, "BA chart 16"),
 ("beshbarmak","czech_dark","dry_stout",1,{}, "кураторская пара Efes 5/5; интенсивность вкуса"),
 ("kazy","rauchbier","czech_pale_premium",5,{}, "Oliver: дым ↔ дым даёт раухбиру преимущество над светлым лагером"),
 ("chak-chak","milk_stout","brut_sparkling",15,{}, "CMS sweets need sweets"),
]

def rank_in_cat(dish_id, drink_id, ctx, use_classics=True):
    d = DISH_BY_ID[dish_id]; b = DRINK_BY_ID[drink_id]
    ranked = sorted(((score_pair(x, d, ctx, use_classics)["score"], x["id"]) for x in DRINKS if x["cat"] == b["cat"]), reverse=True)
    return [i for i, (s, xid) in enumerate(ranked, 1) if xid == drink_id][0]

def evaluate(use_classics=True):
    passed = 0; rows = []
    for dish_id, drink_id, exp in TESTS:
        d = DISH_BY_ID[dish_id]; b = DRINK_BY_ID[drink_id]
        ctx = {"occasion": "meal"} if drink_id == "old_fashioned" else {}
        r = score_pair(b, d, ctx, use_classics)
        rank = rank_in_cat(dish_id, drink_id, ctx, use_classics)
        ncat = sum(1 for x in DRINKS if x["cat"] == b["cat"])
        s = r["score"]; veto = bool(r["vetoes"])
        ok = {"top3": rank <= 3 and s >= 70, "good": s >= 60 and not veto, "bad": s <= 57 and (rank > 3 or ncat <= 3), "avoid": s <= 35 and veto}[exp]
        passed += ok
        rows.append((dish_id, drink_id, exp, s, rank, ",".join(r["vetoes"]), "OK" if ok else "FAIL", r))
    ord_rows = []
    for dish_id, better, worse, gap, ctx, why in ORDINALS:
        sb = score_pair(DRINK_BY_ID[better], DISH_BY_ID[dish_id], ctx, use_classics)["score"]
        sw = score_pair(DRINK_BY_ID[worse], DISH_BY_ID[dish_id], ctx, use_classics)["score"]
        ord_rows.append((dish_id, better, worse, sb, sw, gap, "OK" if sb - sw >= gap else "FAIL", why))
    return passed, rows, ord_rows

def matrix_stats(use_classics=True):
    scores = []
    for d in DISHES:
        for b in DRINKS:
            scores.append(score_pair(b, d, {}, use_classics)["score"])
    scores.sort(); n = len(scores)
    q = lambda p: scores[min(n-1, int(p*n))]
    return dict(n=n, min=scores[0], p10=q(.1), median=q(.5), p90=q(.9), max=scores[-1],
                ge72=round(100*sum(s >= 72 for s in scores)/n), le47=round(100*sum(s <= 47 for s in scores)/n))

if __name__ == "__main__":
    if "--fails" in sys.argv:
        passed, rows, ord_rows = evaluate(True)
        for row in rows:
            if row[6] == "FAIL":
                r = row[7]; print(f"\n=== FAIL {row[0]} x {row[1]} exp={row[2]} score={r['score']} rank={row[4]} core={r['core']} vetoes={r['vetoes']} W={r['W']} F={r['F']}")
                for c in r["contribs"]: print("   ", c)
        for o in ord_rows:
            if o[6] == "FAIL": print("ORDINAL FAIL", o)
        print(f"PASSED {passed}/{len(rows)}; ordinals {sum(o[6]=='OK' for o in ord_rows)}/{len(ord_rows)}")
        sys.exit(0)
    for uc in (True, False):
        passed, rows, ord_rows = evaluate(uc)
        print(f"\n######## use_classics={uc}")
        for row in rows:
            print(f"{row[6]:4} {row[0]:18} {row[1]:24} exp={row[2]:5} score={row[3]:3} rank={row[4]:2} {row[5]}")
        print(f"PASSED {passed}/{len(rows)}")
        for o in ord_rows: print(f"  {o[6]:4} {o[0]:16} {o[1]:>20} {o[3]:3} vs {o[2]:<20} {o[4]:3} (need >= {o[5]:+}) — {o[7]}")
        print("  ordinal passed:", sum(o[6]=="OK" for o in ord_rows), "/", len(ord_rows))
        print("  matrix:", matrix_stats(uc))
    if len(sys.argv) > 1:
        for did, bid in [a.split(":") for a in sys.argv[1:]]:
            r = score_pair(DRINK_BY_ID[bid], DISH_BY_ID[did])
            print(f"\n=== {did} x {bid}: score={r['score']} core={r['core']} vetoes={r['vetoes']} W={r['W']} F={r['F']}")
            for c in r["contribs"]: print("   ", c)

maf:

we need a cool module for automation
like swarm-control
where one peer is the controller and the rest are just "slaves"
alternatively ssh but without ssh
ie, just remote spawning of shells, authed over the swarm
and then automation is just running hyperssh plus piping a script to it


i think bin first
control is just about triggering it
ie the basic bin build script


i wanna split this into a small thing https://github.com/holepunchto/hpn/tree/main/lib/tty
with tweaks
then make hyperssh cross platform
and then just run your script from there :_

deps: submodules core periphery

submodules:
	git submodule init && git submodule update

core:
	cd vendor/uniswap-v3-core && \
		yarn && \
		yarn compile && \
		yarn link && \
		cd ../.. && \
		yarn link @uniswap/v3-core

periphery:
	cd vendor/uniswap-v3-periphery && \
		yarn && \
		yarn compile && \
		yarn link && \
		cd ../.. && \
		yarn link @uniswap/v3-periphery


setup:
	git submodule add https://github.com/Uniswap/uniswap-v3-core.git
	git submodule add https://github.com/Uniswap/uniswap-v3-periphery.git

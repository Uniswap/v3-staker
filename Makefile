deps: core periphery

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

# You don't need to run this since gitmodules are versioned. Leaving here for posterity.
setup:
	git submodule add git@github.com:Uniswap/uniswap-v3-core.git vendor/uniswap-v3-core
	git submodule add git@github.com:Uniswap/uniswap-v3-periphery.git vendor/uniswap-v3-periphery
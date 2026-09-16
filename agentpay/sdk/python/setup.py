from setuptools import setup, find_packages

setup(
    name="frame-pay",
    version="1.0.0",
    description="Official Python SDK for Frame — Autonomous Agent Payments with Policy Guardrails",
    long_description=open("README.md").read() if __import__("os").path.exists("README.md") else "",
    long_description_content_type="text/markdown",
    author="Frame Engineering",
    author_email="dev@frame.dev",
    packages=find_packages(),
    install_requires=[
        "urllib3>=1.26.0",
    ],
    python_requires=">=3.8",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
    ],
)
